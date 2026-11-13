// prism-scan — parallel disk scanner for Prism.
// Usage: prism-scan <root> [keep-files-per-dir]
// Output (stdout, one JSON object per line):
//   {"t":"p","f":files,"d":dirs,"b":bytes,"cur":"path"}            progress
//   {"t":"r","root":{..},"ext":[..],"age":[..],"agen":[..],"top":[..],
//    "files":n,"dirs":n,"bytes":n,"errors":n,"ms":n}               final result
// Node shape: {"n":name,"s":size,"c":fileCount,"m":mtime,"d":[dirs],"f":[[name,size,mtime]],"rc":restCount,"rs":restSize}

use rayon::prelude::*;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

struct Node {
    name: String,
    size: u64,
    count: u64,
    mtime: u64,
    dirs: Vec<Node>,
    files: Vec<(String, u64, u64)>,
    rest_count: u64,
    rest_size: u64,
}

struct Stats {
    ext: HashMap<String, (u64, u64)>,
    age: [u64; 6],
    age_n: [u64; 6],
    top: Vec<(String, u64, u64)>,
    top_min: u64,
}

struct Ctx {
    files: AtomicU64,
    dirs: AtomicU64,
    bytes: AtomicU64,
    errors: AtomicU64,
    stats: Mutex<Stats>,
    cur: Mutex<String>,
    keep: usize,
    now: u64,
}

const TOP_KEEP: usize = 300;
const DAY: u64 = 86_400;

fn ext_of(name: &str) -> String {
    match name.rfind('.') {
        Some(i) if i > 0 && name.len() - i - 1 <= 10 && i + 1 < name.len() => {
            name[i + 1..].to_lowercase()
        }
        _ => String::new(),
    }
}

fn age_bucket(now: u64, mtime: u64) -> usize {
    let age = now.saturating_sub(mtime) / DAY;
    if age < 30 {
        0
    } else if age < 180 {
        1
    } else if age < 365 {
        2
    } else if age < 730 {
        3
    } else if age < 1825 {
        4
    } else {
        5
    }
}

fn scan_dir(path: &Path, name: String, ctx: &Ctx) -> Node {
    let mut node = Node {
        name,
        size: 0,
        count: 0,
        mtime: 0,
        dirs: Vec::new(),
        files: Vec::new(),
        rest_count: 0,
        rest_size: 0,
    };
    ctx.dirs.fetch_add(1, Ordering::Relaxed);
    let rd = match fs::read_dir(path) {
        Ok(r) => r,
        Err(_) => {
            ctx.errors.fetch_add(1, Ordering::Relaxed);
            return node;
        }
    };
    let mut subdirs: Vec<(PathBuf, String)> = Vec::new();
    let mut files: Vec<(String, u64, u64)> = Vec::new();
    for ent in rd.flatten() {
        let ft = match ent.file_type() {
            Ok(f) => f,
            Err(_) => {
                ctx.errors.fetch_add(1, Ordering::Relaxed);
                continue;
            }
        };
        if ft.is_symlink() {
            continue; // symlinks and junctions: never follow
        }
        let fname = ent.file_name().to_string_lossy().into_owned();
        if ft.is_dir() {
            subdirs.push((ent.path(), fname));
        } else {
            let md = match ent.metadata() {
                Ok(m) => m,
                Err(_) => {
                    ctx.errors.fetch_add(1, Ordering::Relaxed);
                    continue;
                }
            };
            let mtime = md
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            files.push((fname, md.len(), mtime));
        }
    }

    if !files.is_empty() {
        let mut bytes = 0u64;
        {
            let mut st = ctx.stats.lock().unwrap();
            for (fname, size, mtime) in files.iter() {
                bytes += *size;
                let e = st.ext.entry(ext_of(fname)).or_insert((0, 0));
                e.0 += 1;
                e.1 += *size;
                let b = age_bucket(ctx.now, *mtime);
                st.age[b] += *size;
                st.age_n[b] += 1;
                if *size > st.top_min {
                    let full = path.join(fname).to_string_lossy().into_owned();
                    st.top.push((full, *size, *mtime));
                    if st.top.len() > TOP_KEEP * 4 {
                        st.top.sort_unstable_by(|a, b| b.1.cmp(&a.1));
                        st.top.truncate(TOP_KEEP);
                        st.top_min = st.top.last().map(|x| x.1).unwrap_or(0);
                    }
                }
            }
        }
        ctx.files.fetch_add(files.len() as u64, Ordering::Relaxed);
        ctx.bytes.fetch_add(bytes, Ordering::Relaxed);
        node.size += bytes;
        node.count += files.len() as u64;
        for f in files.iter() {
            if f.2 > node.mtime {
                node.mtime = f.2;
            }
        }
        files.sort_unstable_by(|a, b| b.1.cmp(&a.1));
        if files.len() > ctx.keep {
            for f in files[ctx.keep..].iter() {
                node.rest_count += 1;
                node.rest_size += f.1;
            }
            files.truncate(ctx.keep);
        }
        node.files = files;
    }

    if let Ok(mut c) = ctx.cur.try_lock() {
        *c = path.to_string_lossy().into_owned();
    }

    let mut dirs: Vec<Node> = subdirs
        .into_par_iter()
        .map(|(p, n)| scan_dir(&p, n, ctx))
        .collect();
    dirs.sort_unstable_by(|a, b| b.size.cmp(&a.size));
    for d in dirs.iter() {
        node.size += d.size;
        node.count += d.count;
        if d.mtime > node.mtime {
            node.mtime = d.mtime;
        }
    }
    node.dirs = dirs;
    node
}

fn write_str<W: Write>(w: &mut W, s: &str) -> io::Result<()> {
    w.write_all(b"\"")?;
    let mut buf = [0u8; 4];
    for ch in s.chars() {
        match ch {
            '"' => w.write_all(b"\\\"")?,
            '\\' => w.write_all(b"\\\\")?,
            '\n' => w.write_all(b"\\n")?,
            '\r' => w.write_all(b"\\r")?,
            '\t' => w.write_all(b"\\t")?,
            c if (c as u32) < 0x20 => write!(w, "\\u{:04x}", c as u32)?,
            c => w.write_all(c.encode_utf8(&mut buf).as_bytes())?,
        }
    }
    w.write_all(b"\"")
}

fn write_node<W: Write>(w: &mut W, n: &Node) -> io::Result<()> {
    w.write_all(b"{\"n\":")?;
    write_str(w, &n.name)?;
    write!(w, ",\"s\":{},\"c\":{},\"m\":{},\"rc\":{},\"rs\":{},\"d\":[", n.size, n.count, n.mtime, n.rest_count, n.rest_size)?;
    for (i, d) in n.dirs.iter().enumerate() {
        if i > 0 {
            w.write_all(b",")?;
        }
        write_node(w, d)?;
    }
    w.write_all(b"],\"f\":[")?;
    for (i, f) in n.files.iter().enumerate() {
        if i > 0 {
            w.write_all(b",")?;
        }
        w.write_all(b"[")?;
        write_str(w, &f.0)?;
        write!(w, ",{},{}]", f.1, f.2)?;
    }
    w.write_all(b"]}")
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: prism-scan <root> [keep]");
        std::process::exit(2);
    }
    let root = args[1].clone();
    let keep: usize = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(24);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let ctx = Arc::new(Ctx {
        files: AtomicU64::new(0),
        dirs: AtomicU64::new(0),
        bytes: AtomicU64::new(0),
        errors: AtomicU64::new(0),
        stats: Mutex::new(Stats {
            ext: HashMap::new(),
            age: [0; 6],
            age_n: [0; 6],
            top: Vec::new(),
            top_min: 0,
        }),
        cur: Mutex::new(String::new()),
        keep,
        now,
    });

    let running = Arc::new(AtomicBool::new(true));
    let reporter = {
        let ctx = Arc::clone(&ctx);
        let running = Arc::clone(&running);
        thread::spawn(move || {
            while running.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(120));
                let cur = ctx.cur.lock().map(|c| c.clone()).unwrap_or_default();
                let out = io::stdout();
                let mut w = out.lock();
                let _ = write!(
                    w,
                    "{{\"t\":\"p\",\"f\":{},\"d\":{},\"b\":{},\"cur\":",
                    ctx.files.load(Ordering::Relaxed),
                    ctx.dirs.load(Ordering::Relaxed),
                    ctx.bytes.load(Ordering::Relaxed)
                );
                let _ = write_str(&mut w, &cur);
                let _ = w.write_all(b"}\n");
                let _ = w.flush();
            }
        })
    };

    let started = Instant::now();
    let tree = scan_dir(Path::new(&root), root.clone(), &ctx);
    running.store(false, Ordering::Relaxed);
    let _ = reporter.join();

    let mut st = ctx.stats.lock().unwrap();
    st.top.sort_unstable_by(|a, b| b.1.cmp(&a.1));
    st.top.truncate(TOP_KEEP);
    let mut exts: Vec<(&String, &(u64, u64))> = st.ext.iter().collect();
    exts.sort_unstable_by(|a, b| (b.1).1.cmp(&(a.1).1));

    let out = io::stdout();
    let mut w = BufWriter::with_capacity(1 << 20, out.lock());
    let _ = w.write_all(b"{\"t\":\"r\",\"root\":");
    let _ = write_node(&mut w, &tree);
    let _ = w.write_all(b",\"ext\":[");
    for (i, (e, v)) in exts.iter().enumerate() {
        if i > 0 {
            let _ = w.write_all(b",");
        }
        let _ = w.write_all(b"[");
        let _ = write_str(&mut w, e);
        let _ = write!(w, ",{},{}]", v.0, v.1);
    }
    let _ = write!(
        w,
        "],\"age\":[{},{},{},{},{},{}],\"agen\":[{},{},{},{},{},{}],\"top\":[",
        st.age[0], st.age[1], st.age[2], st.age[3], st.age[4], st.age[5],
        st.age_n[0], st.age_n[1], st.age_n[2], st.age_n[3], st.age_n[4], st.age_n[5]
    );
    for (i, t) in st.top.iter().enumerate() {
        if i > 0 {
            let _ = w.write_all(b",");
        }
        let _ = w.write_all(b"[");
        let _ = write_str(&mut w, &t.0);
        let _ = write!(w, ",{},{}]", t.1, t.2);
    }
    let _ = write!(
        w,
        "],\"files\":{},\"dirs\":{},\"bytes\":{},\"errors\":{},\"ms\":{},\"engine\":\"rust\"}}\n",
        ctx.files.load(Ordering::Relaxed),
        ctx.dirs.load(Ordering::Relaxed),
        ctx.bytes.load(Ordering::Relaxed),
        ctx.errors.load(Ordering::Relaxed),
        started.elapsed().as_millis()
    );
    let _ = w.flush();
}

#!/usr/bin/env python3
"""Muse — local Instagram posting helper (no Meta Business API, no login).

ASSISTED MODE (this script): for the next unposted card it copies the caption to your clipboard
and opens the image in your default viewer — you just tap "+" in the Instagram app and paste.
It tracks what you've posted in queue.json, so `next` always advances. Zero ban risk: a human
posts, nothing logs into your account.

Usage:
  python3 post-helper.py list                      # show the queue + what's posted
  python3 post-helper.py next  [--lang tri|en|es|pt]   # next unposted card (default: trilingual)
  python3 post-helper.py post <n> [--lang ...]         # a specific card by number
  python3 post-helper.py reset <n>                 # mark a card as NOT posted again

No dependencies. Python 3.8+. Run it from inside this folder.
"""
import argparse
import datetime
import json
import os
import platform
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
QUEUE = os.path.join(HERE, "queue.json")


def load():
    with open(QUEUE, encoding="utf-8") as f:
        return json.load(f)


def save(q):
    with open(QUEUE, "w", encoding="utf-8") as f:
        json.dump(q, f, ensure_ascii=False, indent=2)


def caption_for(post, lang):
    if lang == "tri" or not post.get("captions"):
        return post["caption"]
    return post["captions"].get(lang, post["caption"])


def to_clipboard(text):
    sysname = platform.system()
    try:
        if sysname == "Darwin":
            p = subprocess.Popen(["pbcopy"], stdin=subprocess.PIPE)
        elif sysname == "Windows":
            p = subprocess.Popen(["clip"], stdin=subprocess.PIPE)
        else:  # Linux / BSD — try the common clipboard tools in turn
            p = None
            for cmd in (["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"], ["wl-copy"]):
                try:
                    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
                    break
                except FileNotFoundError:
                    continue
            if p is None:
                return False
        p.communicate(text.encode("utf-8"))
        return p.returncode == 0
    except Exception:
        return False


def open_file(path):
    sysname = platform.system()
    try:
        if sysname == "Darwin":
            subprocess.run(["open", path])
        elif sysname == "Windows":
            os.startfile(path)  # type: ignore[attr-defined]
        else:
            subprocess.run(["xdg-open", path])
    except Exception:
        pass


def cmd_list(q):
    for p in q["posts"]:
        mark = "OK " if p.get("posted") else " . "
        when = f"  ({p['posted_at']})" if p.get("posted_at") else ""
        print(f"[{mark}] #{p['n']:>2}  {p['anchor']}  ({p['cat']}){when}")
    done = sum(1 for p in q["posts"] if p.get("posted"))
    print(f"\n{done}/{len(q['posts'])} posted.")


def do_post(q, post, lang):
    cap = caption_for(post, lang)
    img = os.path.join(HERE, post["img"])
    txt = os.path.splitext(img)[0] + f".{lang}.txt"
    with open(txt, "w", encoding="utf-8") as f:
        f.write(cap)
    copied = to_clipboard(cap)
    print(f"\n> #{post['n']}  {post['anchor']}  ({post['cat']})")
    print(f"  image   : {img}")
    print(f"  caption : {'copied to clipboard' if copied else 'saved to ' + txt}  [{lang}]")
    print("\n" + "-" * 60 + "\n" + cap + "\n" + "-" * 60 + "\n")
    open_file(img)
    ans = input("Posted it? mark as done [y/N]: ").strip().lower()
    if ans == "y":
        post["posted"] = True
        post["posted_at"] = datetime.datetime.now().isoformat(timespec="seconds")
        save(q)
        print("marked posted.")
    else:
        print("left as NOT posted.")


def main():
    ap = argparse.ArgumentParser(description="Muse local IG posting helper (assisted, no API).")
    ap.add_argument("cmd", choices=["list", "next", "post", "reset"])
    ap.add_argument("n", nargs="?", type=int, help="card number (for post/reset)")
    ap.add_argument("--lang", default="tri", choices=["tri", "en", "es", "pt"], help="caption language (default: trilingual)")
    a = ap.parse_args()
    q = load()

    if a.cmd == "list":
        cmd_list(q)
        return
    if a.cmd == "reset":
        for p in q["posts"]:
            if p["n"] == a.n:
                p["posted"] = False
                p.pop("posted_at", None)
                save(q)
                print(f"#{a.n} reset to not-posted.")
                return
        print("no such card number.")
        return
    if a.cmd == "post":
        post = next((p for p in q["posts"] if p["n"] == a.n), None)
        if not post:
            print("no such card number.")
            return
        do_post(q, post, a.lang)
        return
    # next
    post = next((p for p in q["posts"] if not p.get("posted")), None)
    if not post:
        print("All posts done. Re-generate the queue for more, or `reset <n>` to repost one.")
        return
    do_post(q, post, a.lang)


if __name__ == "__main__":
    main()

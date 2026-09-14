/**
 * @file Serves the two web pages (admin and machine management) with a strict CSP.
 *
 * Files are read ONCE at start-up: they are small, and reading from disk per request would open
 * a path for serving arbitrary files.
 */

import fs from "node:fs";
import path from "node:path";
import type { ServerResponse } from "node:http";

export const CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

/** Page files served by Xeon. Kept in one place so a test can check every file exists. */
export const PAGE_FILES = ["admin.html", "admin.js", "machines.html", "machines.js", "shared.css"] as const;
export type PageFile = (typeof PAGE_FILES)[number];

export class StaticPageStore {
  private readonly pages = new Map<PageFile, Buffer>();

  constructor(directory: string) {
    for (const name of PAGE_FILES) {
      this.pages.set(name, fs.readFileSync(path.join(directory, name)));
    }
  }

  /** Writes one page with the security headers. */
  serve(res: ServerResponse, name: PageFile): void {
    const body = this.pages.get(name);
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES[path.extname(name)] ?? "application/octet-stream",
      "Content-Security-Policy": CONTENT_SECURITY_POLICY,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store"
    });
    res.end(body);
  }
}

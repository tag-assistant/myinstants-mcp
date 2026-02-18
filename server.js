#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn, execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, createWriteStream, unlinkSync } from "fs";
import { join } from "path";
import { platform as osPlatform, tmpdir } from "os";
import { get } from "https";

const home = process.env.HOME || process.env.USERPROFILE || "";
const volume = parseFloat(process.env.MYINSTANTS_VOLUME || "0.5") || 0.5;
const defaultWait = process.env.MYINSTANTS_WAIT !== undefined ? process.env.MYINSTANTS_WAIT !== "false" : true;
const BASE = "https://www.myinstants.com";

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const follow = (u) => get(u, { headers: { "User-Agent": "myinstants-mcp/1.0" } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return follow(new URL(res.headers.location, u));
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve(data));
    }).on("error", reject);
    follow(url);
  });
}

function parseResults(html) {
  const pattern = /onclick="play\('(\/media\/sounds\/[^']+)',\s*'[^']*',\s*'([^']+)'\)"/g;
  const results = [];
  let match;
  while ((match = pattern.exec(html)) !== null) {
    results.push({
      slug: match[2],
      name: match[2].replace(/-\d+$/, "").replace(/-/g, " "),
      url: BASE + match[1],
    });
  }
  return results;
}

async function search(query) {
  return parseResults(await httpGet(`${BASE}/en/search/?name=${encodeURIComponent(query)}`));
}

const CATEGORIES = [
  "anime & manga", "games", "memes", "movies", "music", "politics",
  "pranks", "reactions", "sound effects", "sports", "television",
  "tiktok trends", "viral", "whatsapp audios",
];

async function category(name) {
  return parseResults(await httpGet(`${BASE}/en/categories/${encodeURIComponent(name)}/`));
}

async function recent() {
  return parseResults(await httpGet(`${BASE}/en/recent/`));
}

async function bestOfAllTime() {
  return parseResults(await httpGet(`${BASE}/en/best_of_all_time/`));
}

function detectPlatform() {
  const p = osPlatform();
  if (p === "darwin") return "mac";
  if (p === "win32") return "windows";
  if (p === "linux") {
    try { if (/microsoft/i.test(readFileSync("/proc/version", "utf-8"))) return "wsl"; } catch {}
    return "linux";
  }
  return null;
}

function findStreamPlayers() {
  const players = [];
  if (osPlatform() === "darwin") {
    try { execSync("command -v afplay", { stdio: "ignore" }); players.push("afplay"); } catch {}
  }
  for (const p of ["ffplay", "mpv"]) {
    try { execSync(`command -v ${p}`, { stdio: "ignore" }); players.push(p); } catch {}
  }
  return players;
}

function getPlayerCommand(player, fileOrUrl) {
  if (player === "afplay") return ["afplay", ["-v", String(volume), fileOrUrl]];
  if (player === "ffplay") return ["ffplay", ["-nodisp", "-autoexit", "-volume", String(Math.round(volume * 100)), "-loglevel", "quiet", fileOrUrl]];
  if (player === "mpv") return ["mpv", ["--no-video", `--volume=${Math.round(volume * 100)}`, fileOrUrl]];
  return null;
}

function downloadToFile(url, filePath) {
  return new Promise((resolve, reject) => {
    const follow = (u) => get(u, { headers: { "User-Agent": "myinstants-mcp/1.0" } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return follow(new URL(res.headers.location, u));
      const stream = createWriteStream(filePath);
      res.pipe(stream);
      stream.on("finish", () => resolve());
      stream.on("error", reject);
    }).on("error", reject);
    follow(url);
  });
}

function spawnPlayer(cmd) {
  return new Promise(resolve => {
    const child = spawn(cmd[0], cmd[1], { stdio: "ignore" });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

async function streamPlay(url) {
  const players = findStreamPlayers();
  for (const player of players) {
    if (player === "afplay") {
      const tmp = join(tmpdir(), `myinstants-${Date.now()}.mp3`);
      try {
        await downloadToFile(url, tmp);
        const ok = await spawnPlayer(getPlayerCommand("afplay", tmp));
        try { unlinkSync(tmp); } catch {}
        if (ok) return true;
      } catch {
        try { unlinkSync(tmp); } catch {}
      }
    } else {
      const cmd = getPlayerCommand(player, url);
      if (cmd) {
        const ok = await spawnPlayer(cmd);
        if (ok) return true;
      }
    }
  }
  return false;
}

const queue = [];
let playing = false;

function enqueue(url) {
  queue.push(url);
  if (!playing) drain();
}

async function drain() {
  playing = true;
  while (queue.length) await streamPlay(queue.shift());
  playing = false;
}

const server = new McpServer({ name: "myinstants", version: "1.0.0" });

server.resource("trending", "myinstants://trending", { description: "Trending sounds on MyInstants US", mimeType: "text/plain" }, async () => {
  const results = parseResults(await httpGet(`${BASE}/en/index/us/`));
  if (!results.length) return { contents: [{ uri: "myinstants://trending", text: "No trending sounds." }] };
  return { contents: [{ uri: "myinstants://trending", text: results.map(r => `${r.slug}: "${r.name}" → ${r.url}`).join("\n") }] };
});

server.resource("categories", "myinstants://categories", { description: "Available sound categories", mimeType: "text/plain" }, () => {
  return { contents: [{ uri: "myinstants://categories", text: CATEGORIES.join("\n") }] };
});

server.resource("best", "myinstants://best", { description: "Best of all time sounds", mimeType: "text/plain" }, async () => {
  const results = await bestOfAllTime();
  if (!results.length) return { contents: [{ uri: "myinstants://best", text: "No results." }] };
  return { contents: [{ uri: "myinstants://best", text: results.map(r => `${r.slug}: "${r.name}" → ${r.url}`).join("\n") }] };
});

server.tool(
  "search_sounds",
  "Search myinstants.com for sound buttons.",
  { query: z.string().describe("Search query") },
  async ({ query }) => {
    const results = await search(query);
    if (!results.length) return { content: [{ type: "text", text: `No sounds found for "${query}"` }] };
    return { content: [{ type: "text", text: results.slice(0, 20).map((r, i) => `${i + 1}. ${r.name} → \`${r.slug}\``).join("\n") }] };
  }
);

server.tool(
  "browse_category",
  "Browse sounds by category on myinstants.com.",
  { category: z.string().describe(`Category name: ${CATEGORIES.join(", ")}`) },
  async ({ category: cat }) => {
    const match = CATEGORIES.find(c => c.toLowerCase() === cat.toLowerCase()) || cat;
    const results = await category(match);
    if (!results.length) return { content: [{ type: "text", text: `No sounds in category "${cat}"` }] };
    return { content: [{ type: "text", text: `**${match}:**\n` + results.slice(0, 20).map((r, i) => `${i + 1}. ${r.name} → \`${r.slug}\``).join("\n") }] };
  }
);

server.tool(
  "play_sound",
  "Play a sound from myinstants.com. Streams directly — no download needed.",
  {
    slug: z.string().optional().describe("Sound slug from search results"),
    url: z.string().optional().describe("Direct MP3 URL"),
    query: z.string().optional().describe("Quick search — plays first result"),
    wait: z.boolean().optional().default(defaultWait).describe(`Wait for sound to finish before returning (default: ${defaultWait}). Set false for background playback.`),
  },
  async ({ slug, url, query, wait }) => {
    let soundUrl = url;
    let name = url?.split("/").pop()?.replace(/\.\w+$/, "") || "";

    if (query) {
      const results = await search(query);
      if (!results.length) return { content: [{ type: "text", text: `No sounds found for "${query}"` }] };
      soundUrl = results[0].url;
      name = results[0].name;
    } else if (slug) {
      const results = await search(slug.replace(/-/g, " "));
      const match = results.find(r => r.slug === slug) || results[0];
      if (!match) return { content: [{ type: "text", text: `Sound "${slug}" not found` }] };
      soundUrl = match.url;
      name = match.name;
    }

    if (!soundUrl) return { content: [{ type: "text", text: "Provide slug, url, or query." }] };

    if (wait) {
      await streamPlay(soundUrl);
    } else {
      enqueue(soundUrl);
    }
    return { content: [{ type: "text", text: `🔊 ${name}` }] };
  }
);

await server.connect(new StdioServerTransport());

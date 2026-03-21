const express = require("express");
const http = require("http");
const https = require("https");
const zlib = require("zlib");
const querystring = require("querystring");

const router = express.Router();

const CONFIG = {
  baseUrl: "http://85.195.94.50/sms",
  username: "Junaidniz786",
  password: "Junaidniz786",
  userAgent:
    "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120 Safari/537.36"
};

let cookies = [];

function safeJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { error: "Invalid JSON from server" };
  }
}

function request(method, url, data = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;

    const headers = {
      "User-Agent": CONFIG.userAgent,
      Accept: "*/*",
      "Accept-Encoding": "gzip, deflate",
      Cookie: cookies.join("; "),
      ...extraHeaders
    };

    if (method === "POST" && data) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Content-Length"] = Buffer.byteLength(data);
    }

    const req = lib.request(url, { method, headers }, res => {
      if (res.headers["set-cookie"]) {
        res.headers["set-cookie"].forEach(c => {
          const cookie = c.split(";")[0];
          const key = cookie.split("=")[0];
          cookies = cookies.filter(ck => !ck.startsWith(key + "="));
          cookies.push(cookie);
        });
      }

      let chunks = [];
      res.on("data", d => chunks.push(d));
      res.on("end", () => {
        let buffer = Buffer.concat(chunks);
        try {
          if (res.headers["content-encoding"] === "gzip")
            buffer = zlib.gunzipSync(buffer);
        } catch {}
        resolve(buffer.toString());
      });
    });

    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function login() {
  cookies = [];

  const page = await request("GET", `${CONFIG.baseUrl}/SignIn`);

  const match = page.match(/(\d+)\s*\+\s*(\d+)\s*=\s*\?/i);
  const ans = match ? Number(match[1]) + Number(match[2]) : 10;

  const form = querystring.stringify({
    username: CONFIG.username,
    password: CONFIG.password,
    capt: ans
  });

  await request(
    "POST",
    `${CONFIG.baseUrl}/signmein`,
    form,
    { Referer: `${CONFIG.baseUrl}/SignIn` }
  );
}

function cleanHtml(str) {
  if (typeof str !== "string") return String(str || "");
  return str.replace(/<[^>]+>/g, "").trim();
}

async function getNumbers() {
  const url =
    `${CONFIG.baseUrl}/dialer/ajax/dt_numbers.php?` +
    `ftermination=&sEcho=1&iColumns=3&sColumns=%2C%2C` +
    `&iDisplayStart=0&iDisplayLength=25` +
    `&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true` +
    `&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true` +
    `&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true` +
    `&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=asc&iSortingCols=1` +
    `&_=${Date.now()}`;

  const data = await request("GET", url, null, {
    Referer: `${CONFIG.baseUrl}/dialer/`,
    "X-Requested-With": "XMLHttpRequest"
  });

  const parsed = safeJSON(data);
  if (parsed.aaData) {
    parsed.aaData = parsed.aaData.map(row => row.map(cell => cleanHtml(String(cell || ""))));
  }
  return parsed;
}

async function getSMS() {
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];

  const url =
    `${CONFIG.baseUrl}/dialer/ajax/dt_reports.php?` +
    `fdate1=${dateStr}%2000:00:00&fdate2=${dateStr}%2023:59:59` +
    `&ftermination=&fnum=&fcli=&fgdate=0&fgtermination=0&fgnumber=0&fgcli=0&fg=0` +
    `&sEcho=1&iColumns=8&sColumns=%2C%2C%2C%2C%2C%2C%2C` +
    `&iDisplayStart=0&iDisplayLength=25` +
    `&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true` +
    `&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true` +
    `&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true` +
    `&mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true` +
    `&mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true` +
    `&mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true` +
    `&mDataProp_6=6&sSearch_6=&bRegex_6=false&bSearchable_6=true&bSortable_6=true` +
    `&mDataProp_7=7&sSearch_7=&bRegex_7=false&bSearchable_7=true&bSortable_7=true` +
    `&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=desc&iSortingCols=1` +
    `&_=${Date.now()}`;

  const data = await request("GET", url, null, {
    Referer: `${CONFIG.baseUrl}/dialer/`,
    "X-Requested-With": "XMLHttpRequest"
  });

  const parsed = safeJSON(data);
  if (parsed.aaData) {
    parsed.aaData = parsed.aaData.map(row => row.map(cell => cleanHtml(String(cell || ""))));
  }
  return parsed;
}

router.get("/", async (req, res) => {
  const type = req.query.type;

  if (!type) return res.json({ error: "Use ?type=numbers OR ?type=sms" });

  try {
    await login();

    let result;

    if (type === "numbers") result = await getNumbers();
    else if (type === "sms") result = await getSMS();
    else return res.json({ error: "Invalid type" });

    res.json(result);
  } catch (err) {
    res.json({ error: err.message });
  }
});

module.exports = router;

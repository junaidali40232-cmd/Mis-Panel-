const express = require('express');
const axios = require('axios');
const router = express.Router();

// --- CONFIGURATION ---
const CREDENTIALS = {
    username: "Murtda1463",
    password: "Murtda1463"
};

const BASE_URL = "http://45.82.67.20/ints";
const STATS_PAGE_URL = `${BASE_URL}/client/SMSCDRReports`;

const COMMON_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
    "Origin": BASE_URL,
    "Accept-Language": "en-US,en;q=0.9,ur-PK;q=0.8,ur;q=0.7"
};

// --- GLOBAL STATE ---
let STATE = {
    cookie: null,
    sessKey: null,
    loginPromise: null
};

// --- HELPERS ---
function getTodayDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function extractKey(html) {
    const patterns = [
        /sesskey=([A-Za-z0-9+/=]+)/,
        /sesskey\s*[:=]\s*["']([^"']+)["']/,
        /[?&]sesskey=([^&"'\s]+)/,
        /sesskey","([^"]+)"/,
    ];
    for (const p of patterns) {
        const m = html.match(p);
        if (m && m[1]) {
            console.log(`✅ sessKey found: ${m[1].substring(0,20)}...`);
            return m[1];
        }
    }
    console.error("❌ sessKey not found in HTML. Sample:", html.substring(0, 2000));
    return null;
}

// --- CORE LOGIN FUNCTION ---
function performLogin() {
    if (STATE.loginPromise) {
        console.log("⏳ Login already in progress, waiting...");
        return STATE.loginPromise;
    }

    STATE.loginPromise = _doLogin().finally(() => {
        STATE.loginPromise = null;
    });

    return STATE.loginPromise;
}

async function _doLogin() {
    console.log("🔐 Starting login for CLIENT area...");

    const instance = axios.create({
        headers: COMMON_HEADERS,
        timeout: 20000,
        withCredentials: true
    });

    let tempCookie = "";
    try {
        // Step 1: GET login page (session cookie + captcha)
        const r1 = await instance.get(`${BASE_URL}/login`);
        console.log("📄 Login page fetched. Status:", r1.status);

        if (r1.headers['set-cookie']) {
            const c = r1.headers['set-cookie'].find(x => x.includes('PHPSESSID'));
            if (c) {
                tempCookie = c.split(';')[0];
                console.log("🍪 Initial cookie:", tempCookie);
            }
        }

        // Captcha solve karo
        const match = r1.data.match(/What is\s+(\d+)\s*\+\s*(\d+)/i);
        const ans = match ? parseInt(match[1]) + parseInt(match[2]) : 4;
        console.log("🔢 Captcha answer:", ans, match ? `(${match[1]}+${match[2]})` : "(fallback=4)");

        // Step 2: POST signin
        const r2 = await instance.post(
            `${BASE_URL}/signin`,
            new URLSearchParams({
                username: CREDENTIALS.username,
                password: CREDENTIALS.password,
                capt: String(ans)
            }),
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Cookie": tempCookie,
                    "Referer": `${BASE_URL}/login`
                },
                maxRedirects: 0,
                validateStatus: () => true
            }
        );

        console.log("📬 Signin response status:", r2.status);
        console.log("📬 Signin headers:", JSON.stringify(r2.headers['set-cookie'] || []));

        // Cookie update karo
        if (r2.headers['set-cookie']) {
            const newC = r2.headers['set-cookie'].find(x => x.includes('PHPSESSID'));
            STATE.cookie = newC ? newC.split(';')[0] : tempCookie;
        } else {
            STATE.cookie = tempCookie;
        }
        console.log("🍪 Final cookie:", STATE.cookie);

    } catch (e) {
        console.error("❌ Login step 1/2 failed:", e.message);
        throw e;
    }

    // Step 3: sessKey fetch karo from CLIENT pages
    try {
        // Try multiple CLIENT area pages
        const pagesToTry = [
            `${BASE_URL}/client/SMSCDRReports`,
            `${BASE_URL}/client/MySMSNumbers`,
            `${BASE_URL}/client/Dashboard`,
        ];

        for (const pageUrl of pagesToTry) {
            try {
                console.log(`📄 Trying to get sessKey from: ${pageUrl}`);
                const r3 = await axios.get(pageUrl, {
                    headers: {
                        ...COMMON_HEADERS,
                        "Cookie": STATE.cookie,
                        "Referer": `${BASE_URL}/client`
                    },
                    timeout: 20000
                });

                console.log("📄 Page status:", r3.status);

                // Agar redirect ya login page aa jaye
                if (r3.data && (r3.data.includes('id="loginform"') || r3.data.includes('/ints/login'))) {
                    console.error("❌ Page returned login page — credentials/cookie wrong!");
                    continue;
                }

                const key = extractKey(r3.data);
                if (key) {
                    STATE.sessKey = key;
                    console.log("✅ Login complete! sessKey stored from:", pageUrl);
                    return;
                }
            } catch (e) {
                console.log(`⚠️ Failed to fetch ${pageUrl}:`, e.message);
                continue;
            }
        }

        // If no sesskey found, try to extract from data endpoint
        console.log("⚠️ Trying data endpoint for sessKey...");
        try {
            const r4 = await axios.get(`${BASE_URL}/client/res/data_smscdr.php?fg=0`, {
                headers: {
                    ...COMMON_HEADERS,
                    "Cookie": STATE.cookie
                },
                timeout: 15000
            });
            
            const key = extractKey(r4.data);
            if (key) {
                STATE.sessKey = key;
                console.log("✅ sessKey found via data endpoint.");
                return;
            }
        } catch (e) {
            console.error("❌ Data endpoint failed:", e.message);
        }

        // Last resort: use empty sesskey
        console.log("⚠️ No sessKey found, using empty value...");
        STATE.sessKey = "";

    } catch (e) {
        console.error("❌ sessKey fetch failed:", e.message);
        throw e;
    }
}

// --- AUTO REFRESH: har 90 seconds ---
setInterval(() => {
    console.log("🔄 Auto refresh login...");
    performLogin().catch(e => console.error("Auto-refresh error:", e.message));
}, 90000);

// --- API ROUTE ---
router.get('/', async (req, res) => {
    const { type } = req.query;

    // Agar session nahi hai toh login karo aur WAIT karo
    if (!STATE.cookie || STATE.sessKey === null) {
        console.log("🔄 No session, performing login...");
        try {
            await performLogin();
        } catch(e) {
            return res.status(500).json({ error: "Login failed: " + e.message });
        }

        // Login ke baad bhi nahi mila?
        if (!STATE.cookie) {
            return res.status(503).json({
                error: "Login failed — check credentials or server availability.",
                debug: {
                    cookie: STATE.cookie ? "present" : "missing",
                    sessKey: STATE.sessKey ? "present" : "missing"
                }
            });
        }
    }

    const ts = Date.now();
    const today = getTodayDate();
    let targetUrl = "", referer = "";

    if (type === 'numbers') {
        referer = `${BASE_URL}/client/MySMSNumbers`;
        targetUrl = `${BASE_URL}/client/res/data_smsnumbers.php`
            + `?frange=&fclient=`
            + `&sEcho=1`
            + `&iColumns=6`
            + `&sColumns=%2C%2C%2C%2C%2C`
            + `&iDisplayStart=0&iDisplayLength=5000`
            + `&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true`
            + `&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true`
            + `&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true`
            + `&mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true`
            + `&mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true`
            + `&mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true`
            + `&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=asc&iSortingCols=1`
            + `&_=${ts}`;

    } else if (type === 'sms') {
        referer = `${BASE_URL}/client/SMSCDRReports`;
        targetUrl = `${BASE_URL}/client/res/data_smscdr.php`
            + `?fdate1=${today}%2000:00:00&fdate2=${today}%2023:59:59`
            + `&frange=&fnum=&fcli=&fgdate=&fgmonth=&fgrange=&fgnumber=&fgcli=&fg=0`
            + `&sesskey=${STATE.sessKey}`
            + `&sEcho=1`
            + `&iColumns=7`
            + `&sColumns=%2C%2C%2C%2C%2C%2C`
            + `&iDisplayStart=0&iDisplayLength=5000`
            + `&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true`
            + `&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true`
            + `&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true`
            + `&mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true`
            + `&mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true`
            + `&mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true`
            + `&mDataProp_6=6&sSearch_6=&bRegex_6=false&bSearchable_6=true&bSortable_6=true`
            + `&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=desc&iSortingCols=1`
            + `&_=${ts}`;
    } else {
        return res.status(400).json({ error: "Invalid type. Use ?type=numbers or ?type=sms" });
    }

    try {
        console.log("📡 Fetching:", targetUrl.substring(0, 100));
        const response = await axios.get(targetUrl, {
            headers: {
                ...COMMON_HEADERS,
                "Cookie": STATE.cookie,
                "Referer": referer
            },
            timeout: 20000
        });

        // Session expired check
        if (typeof response.data === 'string' &&
            (response.data.includes('<html') || response.data.toLowerCase().includes('login'))) {
            console.warn("⚠️ Session expired, re-logging in...");
            STATE.cookie = null;
            STATE.sessKey = null;
            try {
                await performLogin();
            } catch(e) {
                return res.status(500).json({ error: "Re-login failed: " + e.message });
            }
            return res.status(503).json({ error: "Session was expired. Please retry request." });
        }

        let result = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;

        if (type === 'numbers') result = fixNumbers(result);
        if (type === 'sms')     result = fixSMS(result);

        res.set('Content-Type', 'application/json');
        res.json(result);

    } catch (e) {
        if (e.response?.status === 403) {
            STATE.cookie = null;
            STATE.sessKey = null;
            performLogin().catch(() => {});
            return res.status(403).json({ error: "403 Forbidden — session reset, retry in 5 seconds." });
        }
        console.error("❌ Fetch error:", e.message);
        res.status(500).json({ error: e.message });
    }
});

// --- EXPORT ---
module.exports = router;

// --- INITIAL LOGIN (startup pe) ---
performLogin().catch(e => console.error("Initial login error:", e.message));

/* ================= FIX NUMBERS ================= */
function fixNumbers(data) {
  if (!data.aaData) return data;

  data.aaData = data.aaData.map(row => [
    row[1],
    "",
    row[3],
    (row[4] || "").replace(/<[^>]+>/g, "").trim(),
    (row[7] || "").replace(/<[^>]+>/g, "").trim()
  ]);

  return data;
}

/* ================= FIX SMS ================= */
function fixSMS(data) {
  if (!data.aaData) return data;

  data.aaData = data.aaData
    .map(row => {
      let message = (row[5] || "")
        .replace(/kamibroken/gi, "")
        .trim();

      if (!message) return null;

      return [
        row[0], // date
        row[1], // range
        row[2], // number
        row[3], // service
        message, // OTP MESSAGE
        "$",
        row[6] || 0 // cost
      ];
    })
    .filter(Boolean);

  return data;
  }

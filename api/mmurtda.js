const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

const CREDENTIALS = {
    username: "
    password: ""
};

const BASE_URL = "http://51.89.99.105/NumberPanel";
const STATS_PAGE_URL = `${BASE_URL}/client/SMSCDRStats`;

const COMMON_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
    "Origin": "http://51.89.99.105",
    "Accept-Language": "en-US,en;q=0.9,ur-PK;q=0.8,ur;q=0.7"
};

let STATE = {
    cookie: null,
    sessKey: null,
    isLoggingIn: false,
    lastSeenSmsIds: new Set()
};

function getTodayDate() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function extractKey(html) {
    let match = html.match(/sesskey=([^&"']+)/);
    if (match) return match[1];
    match = html.match(/sesskey\s*[:=]\s*["']([^"']+)["']/);
    if (match) return match[1];
    return null;
}

async function performLogin() {
    if (STATE.isLoggingIn) return;
    STATE.isLoggingIn = true;
    console.log("🔄 Starting Client Login...");
    try {
        const instance = axios.create({ withCredentials: true, headers: COMMON_HEADERS, timeout: 15000 });
        const r1 = await instance.get(`${BASE_URL}/login`);
        let tempCookie = "";
        if (r1.headers['set-cookie']) {
            const c = r1.headers['set-cookie'].find(x => x.includes('PHPSESSID'));
            if (c) tempCookie = c.split(';')[0];
        }
        const match = r1.data.match(/What is (\d+) \+ (\d+) = \?/);
        if (!match) throw new Error("Captcha Not Found");
        const ans = parseInt(match[1]) + parseInt(match[2]);
        const params = new URLSearchParams();
        params.append('username', CREDENTIALS.username);
        params.append('password', CREDENTIALS.password);
        params.append('capt', ans);
        const r2 = await instance.post(`${BASE_URL}/signin`, params, {
            headers: { "Content-Type": "application/x-www-form-urlencoded", "Cookie": tempCookie, "Referer": `${BASE_URL}/login` },
            maxRedirects: 0,
            validateStatus: () => true
        });
        if (r2.headers['set-cookie']) {
            const newC = r2.headers['set-cookie'].find(x => x.includes('PHPSESSID'));
            if (newC) STATE.cookie = newC.split(';')[0];
        } else {
            STATE.cookie = tempCookie;
        }
        console.log("✅ Login Success. Cookie:", STATE.cookie);
        const r3 = await axios.get(STATS_PAGE_URL, {
            headers: { ...COMMON_HEADERS, "Cookie": STATE.cookie, "Referer": `${BASE_URL}/client/SMSDashboard` }
        });
        const foundKey = extractKey(r3.data);
        if (foundKey) {
            STATE.sessKey = foundKey;
            console.log("🔥 SessKey FOUND:", STATE.sessKey);
        } else {
            console.log("❌ SessKey NOT found.");
        }
    } catch (e) {
        console.error("❌ Login Failed:", e.message);
    } finally {
        STATE.isLoggingIn = false;
    }
}

setInterval(() => { performLogin(); }, 120000);

async function fetchData(targetUrl, specificReferer) {
    const response = await axios.get(targetUrl, {
        headers: { ...COMMON_HEADERS, "Cookie": STATE.cookie, "Referer": specificReferer },
        responseType: 'arraybuffer',
        timeout: 25000
    });

    const checkData = response.data.subarray(0, 200).toString();

    // ✅ FIX: Sirf <html check karein, 'login' word nahi (SMS mein hota hai)
    if (checkData.trim().startsWith('<')) {
        return null; // Session expired
    }

    return response.data;
}

app.get('/api', async (req, res) => {
    const { type } = req.query;

    if (!STATE.cookie || !STATE.sessKey) {
        await performLogin();
        if (!STATE.sessKey) return res.status(500).json({ error: "Waiting for Login..." });
    }

    const ts = Date.now();
    const today = getTodayDate();
    let targetUrl = "", specificReferer = "";

    if (type === 'numbers') {
        specificReferer = `${BASE_URL}/client/MySMSNumbers`;
        targetUrl = `${BASE_URL}/client/res/data_smsnumbers.php?frange=&fclient=&sEcho=2&iColumns=6&sColumns=%2C%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=-1&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true&mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true&mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true&mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=asc&iSortingCols=1&_=${ts}`;
    } else if (type === 'sms' || type === 'new-sms') {
        specificReferer = `${BASE_URL}/client/SMSCDRStats`;
        targetUrl = `${BASE_URL}/client/res/data_smscdr.php?fdate1=${today}%2000:00:00&fdate2=${today}%2023:59:59&frange=&fnum=&fcli=&fgdate=&fgmonth=&fgrange=&fgnumber=&fgcli=&fg=0&sesskey=${STATE.sessKey}&sEcho=2&iColumns=7&sColumns=%2C%2C%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=-1&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true&mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true&mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true&mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true&mDataProp_6=6&sSearch_6=&bRegex_6=false&bSearchable_6=true&bSortable_6=true&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=desc&iSortingCols=1&_=${ts}`;
    } else {
        return res.status(400).json({ error: "Invalid type. Use ?type=sms, ?type=numbers, or ?type=new-sms" });
    }

    try {
        console.log(`📡 Fetching: ${type}`);

        let data = await fetchData(targetUrl, specificReferer);

        // ✅ Session expire hogi to auto login karke dobara try karega
        if (data === null) {
            console.log("⚠️ Session Expired. Re-logging in...");
            await performLogin();
            data = await fetchData(targetUrl, specificReferer);
            if (data === null) {
                return res.status(503).json({ error: "Session error. Please try again." });
            }
        }

        if (type === 'new-sms') {
            try {
                const jsonData = JSON.parse(data.toString('utf-8'));
                const allRows = jsonData.aaData || [];
                const newRows = allRows.filter(row => !STATE.lastSeenSmsIds.has(row[0]));
                allRows.forEach(row => STATE.lastSeenSmsIds.add(row[0]));
                return res.json({ newCount: newRows.length, newSms: newRows, date: today });
            } catch (e) {
                res.set('Content-Type', 'application/json');
                return res.send(data);
            }
        }

        res.set('Content-Type', 'application/json');
        res.send(data);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/reset-seen', (req, res) => {
    STATE.lastSeenSmsIds.clear();
    res.json({ success: true, message: "Seen SMS IDs cleared." });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    performLogin();
});
Mar 22, 11:51 AM

Hey Junaid, Quick input needed :
Agent will continue working after your reply
Bilkul! Yeh rahi updated script jo session expire hone par auto re-login karegi:

const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

const CREDENTIALS = {
    username: "Murtda1463",
    password: "Murtda1463"
};

const BASE_URL = "http://45.82.67.20/ints";
const STATS_PAGE_URL = `${BASE_URL}/client/SMSCDRReports`;

const COMMON_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
    "Origin": "http://45.82.67.20",
    "Accept-Language": "en-US,en;q=0.9,ur-PK;q=0.8,ur;q=0.7"
};

let STATE = {
    cookie: null,
    sessKey: null,
    isLoggingIn: false,
    lastSeenSmsIds: new Set()
};

function getTodayDate() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function extractKey(html) {
    const patterns = [
        /sesskey=([A-Za-z0-9+/=]+)/,
        /sesskey\s*[:=]\s*["']([^"']+)["']/,
        /[?&]sesskey=([^&"'\s]+)/,
        /sesskey","([^"]+)"/
    ];
    
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
            return match[1];
        }
    }
    return null;
}

async function performLogin() {
    if (STATE.isLoggingIn) {
        console.log("⏳ Login already in progress...");
        return;
    }
    
    STATE.isLoggingIn = true;
    console.log("🔄 Starting Client Login...");
    
    try {
        const instance = axios.create({ 
            withCredentials: true, 
            headers: COMMON_HEADERS, 
            timeout: 15000 
        });

        // Step 1: Get login page
        const r1 = await instance.get(`${BASE_URL}/login`);
        let tempCookie = "";
        
        if (r1.headers['set-cookie']) {
            const c = r1.headers['set-cookie'].find(x => x.includes('PHPSESSID'));
            if (c) tempCookie = c.split(';')[0];
        }

        // Step 2: Solve captcha
        const match = r1.data.match(/What is\s+(\d+)\s*\+\s*(\d+)/i);
        if (!match) {
            console.error("❌ Captcha Not Found");
            throw new Error("Captcha Not Found");
        }
        
        const ans = parseInt(match[1]) + parseInt(match[2]);
        console.log(`🔢 Captcha: ${match[1]} + ${match[2]} = ${ans}`);

        // Step 3: Submit login
        const params = new URLSearchParams();
        params.append('username', CREDENTIALS.username);
        params.append('password', CREDENTIALS.password);
        params.append('capt', ans);

        const r2 = await instance.post(`${BASE_URL}/signin`, params, {
            headers: { 
                "Content-Type": "application/x-www-form-urlencoded", 
                "Cookie": tempCookie, 
                "Referer": `${BASE_URL}/login` 
            },
            maxRedirects: 0,
            validateStatus: () => true
        });

        console.log("📬 Signin status:", r2.status);

        // Update cookie
        if (r2.headers['set-cookie']) {
            const newC = r2.headers['set-cookie'].find(x => x.includes('PHPSESSID'));
            if (newC) STATE.cookie = newC.split(';')[0];
        } else {
            STATE.cookie = tempCookie;
        }

        console.log("✅ Login Success. Cookie:", STATE.cookie);

        // Step 4: Try to get sessKey from multiple pages
        const pagesToTry = [
            `${BASE_URL}/client/SMSCDRReports`,
            `${BASE_URL}/client/MySMSNumbers`,
            `${BASE_URL}/client/res/data_smscdr.php?fg=0`
        ];

        for (const pageUrl of pagesToTry) {
            try {
                console.log(`🔍 Trying: ${pageUrl}`);
                const r3 = await axios.get(pageUrl, {
                    headers: { 
                        ...COMMON_HEADERS, 
                        "Cookie": STATE.cookie, 
                        "Referer": `${BASE_URL}/client` 
                    },
                    timeout: 15000
                });

                // Check if we got login page back
                if (r3.data.includes('id="loginform"') || r3.data.includes('/ints/login')) {
                    console.log("⚠️ Got login page back, trying next...");
                    continue;
                }

                const foundKey = extractKey(r3.data);
                if (foundKey) {
                    STATE.sessKey = foundKey;
                    console.log("🔥 SessKey FOUND:", STATE.sessKey.substring(0, 20) + "...");
                    STATE.isLoggingIn = false;
                    return;
                }
            } catch (e) {
                console.log(`⚠️ Page ${pageUrl} failed:`, e.message);
                continue;
            }
        }

        // If no sesskey found, use empty
        console.log("⚠️ SessKey NOT found, using empty value");
        STATE.sessKey = "";

    } catch (e) {
        console.error("❌ Login Failed:", e.message);
        STATE.cookie = null;
        STATE.sessKey = null;
    } finally {
        STATE.isLoggingIn = false;
    }
}

// Auto-refresh session every 2 minutes
setInterval(() => { 
    console.log("🔄 Auto refresh session...");
    performLogin(); 
}, 120000);

async function fetchData(targetUrl, specificReferer) {
    try {
        const response = await axios.get(targetUrl, {
            headers: { 
                ...COMMON_HEADERS, 
                "Cookie": STATE.cookie, 
                "Referer": specificReferer 
            },
            responseType: 'arraybuffer',
            timeout: 25000
        });

        const checkData = response.data.subarray(0, 200).toString();

        // ✅ Check if session expired (HTML response instead of JSON)
        if (checkData.trim().startsWith('<')) {
            console.log("⚠️ Got HTML response - session expired");
            return null; // Session expired
        }

        return response.data;
    } catch (e) {
        console.error("❌ Fetch error:", e.message);
        throw e;
    }
}

app.get('/api', async (req, res) => {
    const { type } = req.query;

    // Ensure we have session
    if (!STATE.cookie || STATE.sessKey === null) {
        console.log("🔄 No session, logging in...");
        await performLogin();
        
        if (!STATE.cookie) {
            return res.status(500).json({ error: "Login failed. Please check credentials." });
        }
    }

    const ts = Date.now();
    const today = getTodayDate();
    let targetUrl = "", specificReferer = "";

    if (type === 'numbers') {
        specificReferer = `${BASE_URL}/client/MySMSNumbers`;
        targetUrl = `${BASE_URL}/client/res/data_smsnumbers.php?frange=&fclient=&sEcho=1&iColumns=6&sColumns=%2C%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=5000&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true&mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true&mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true&mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=asc&iSortingCols=1&_=${ts}`;
    } else if (type === 'sms' || type === 'new-sms') {
        specificReferer = `${BASE_URL}/client/SMSCDRReports`;
        targetUrl = `${BASE_URL}/client/res/data_smscdr.php?fdate1=${today}%2000:00:00&fdate2=${today}%2023:59:59&frange=&fnum=&fcli=&fgdate=&fgmonth=&fgrange=&fgnumber=&fgcli=&fg=0&sesskey=${STATE.sessKey}&sEcho=1&iColumns=7&sColumns=%2C%2C%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=5000&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true&mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true&mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true&mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true&mDataProp_6=6&sSearch_6=&bRegex_6=false&bSearchable_6=true&bSortable_6=true&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=desc&iSortingCols=1&_=${ts}`;
    } else {
        return res.status(400).json({ error: "Invalid type. Use ?type=sms, ?type=numbers, or ?type=new-sms" });
    }

    try {
        console.log(`📡 Fetching: ${type}`);

        let data = await fetchData(targetUrl, specificReferer);

        // ✅ Session expire hogi to auto login karke dobara try karega
        if (data === null) {
            console.log("⚠️ Session Expired. Re-logging in...");
            await performLogin();
            
            // Retry after login
            data = await fetchData(targetUrl, specificReferer);
            
            if (data === null) {
                return res.status(503).json({ error: "Session error. Please try again." });
            }
        }

        // Handle new-sms type (track new messages)
        if (type === 'new-sms') {
            try {
                const jsonData = JSON.parse(data.toString('utf-8'));
                const allRows = jsonData.aaData || [];
                
                // Filter new SMS
                const newRows = allRows.filter(row => !STATE.lastSeenSmsIds.has(row[0]));
                
                // Update seen IDs
                allRows.forEach(row => STATE.lastSeenSmsIds.add(row[0]));
                
                return res.json({ 
                    newCount: newRows.length, 
                    newSms: newRows, 
                    date: today 
                });
            } catch (e) {
                console.error("Error parsing new-sms:", e.message);
                res.set('Content-Type', 'application/json');
                return res.send(data);
            }
        }

        // Return normal response
        res.set('Content-Type', 'application/json');
        res.send(data);

    } catch (error) {
        console.error("❌ API Error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// Reset seen SMS IDs
app.post('/reset-seen', (req, res) => {
    STATE.lastSeenSmsIds.clear();
    console.log("🔄 Seen SMS IDs cleared");
    res.json({ success: true, message: "Seen SMS IDs cleared." });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: "ok",
        hasCookie: !!STATE.cookie,
        hasSessKey: !!STATE.sessKey,
        seenSmsCount: STATE.lastSeenSmsIds.size
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 Base URL: ${BASE_URL}`);
    console.log(`👤 Username: ${CREDENTIALS.username}`);
    performLogin();
});

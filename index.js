const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

// --- IMPORT ALL PANELS ---
const junaid = require("./api/junaid");
const pjunaid = require("./api/pjunaid")
const mmurtda = require("./api/mmurtda");

// --- ROUTES ---
app.use("/api/junaid", junaid);
app.use("/api/pjunaid", pjunaid);
app.use("/api/mmurtda", mmurtda);


// --- HEALTH CHECK ---
app.get("/", (req,res)=> res.send("API RUNNING ✅"));

// --- START SERVER ---
app.listen(PORT, "0.0.0.0", ()=>console.log(`🚀 Server running on port ${PORT}`));

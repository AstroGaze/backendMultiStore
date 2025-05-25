// backend/lib/supabaseClient.js
const { createClient } = require("@supabase/supabase-js");
const dotenv = require("dotenv");
const path = require("path");

// Load .env from the backend root directory
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error(
    "Supabase URL or Service Key is missing. Check your .env file."
  );
  // Optionally, exit or throw an error if these are critical for startup
  // process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  // It's good practice to specify auth options, even for service roles
  auth: {
    // persistSession: false, // Not strictly necessary for service role but good to be explicit
    // autoRefreshToken: false, // Not needed for service role
  },
});

module.exports = supabase;

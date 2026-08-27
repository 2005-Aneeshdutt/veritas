/** @type {import('next').NextConfig} */

// Where the API lives.
//
// Local development talks to uvicorn on 8000. A deployment sets
// DOCTOR_API_URL to the backend's origin, so the browser still calls
// same-origin /api/* and the rewrite forwards it -- no CORS in the browser,
// and no API URL baked into the client bundle.
//
// Hosts differ on what they hand you: some give a full URL, Render's
// `hostport` gives "host:port" with no scheme. A missing scheme would make
// the rewrite a relative path and fail at runtime rather than at build, so it
// is filled in here instead of being assumed.
const raw = process.env.DOCTOR_API_URL || "http://127.0.0.1:8000";
const API = /^https?:\/\//.test(raw)
  ? raw
  : `${raw.startsWith("localhost") || raw.startsWith("127.") ? "http" : "https"}://${raw}`;

module.exports = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/api/:path*` }];
  },
};

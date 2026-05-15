// ─────────────────────────────────────────────────────────────────────────
//  eSSF Curve — Authorized Users
// ─────────────────────────────────────────────────────────────────────────
//
//  This file controls who can log into eSSF Curve.
//
//  PASSWORDS ARE STORED AS SHA-256 HASHES, NOT PLAIN TEXT.
//
//  HOW TO ADD A NEW USER:
//  1. Decide on a password. Long, random, 14+ characters.
//  2. Generate the SHA-256 hash. In your browser console (F12), paste:
//
//       crypto.subtle.digest("SHA-256",
//         new TextEncoder().encode("YOUR_PASSWORD")
//       ).then(b => console.log(
//         Array.from(new Uint8Array(b))
//           .map(x => x.toString(16).padStart(2,"0")).join("")
//       ));
//
//  3. Add an entry to USERS below with email, hash, label, and role.
//  4. Send the password to the user SEPARATELY from the URL.
//
//  ROLES:
//     "admin"  — Full access. Lab lead. Sees and uses everything.
//     "member" — Currently sees "Pending access" screen. Cannot use the app
//                yet. Switch to "admin" when their access should be enabled.
//
//  TO REMOVE A USER:  delete their entry, redeploy.
//  TO ROTATE A PASSWORD:  generate new hash, replace entry, redeploy.
//  TO FORCE EVERYONE TO RE-LOGIN:  change SESSION_VERSION below.
// ─────────────────────────────────────────────────────────────────────────

export const SESSION_VERSION = "2025-05-A";
export const SESSION_MAX_AGE_DAYS = 60;


export const USERS = [
  {
    email: "mcgracie@ncsu.edu",
    hash: "5c06eb3d5a05a19f49476d694ca81a36344660e9d5b98e3d6a6630f31c2422e7",
    label: "Lab Lead",
    role: "admin",
  },
  {
    email: "sljohns8@ncsu.edu",
    hash: "26077d289339a390726bcd297d9a9e2cfcbfe5a950e240a9bfcebe3f61543ff6",
    label: "Analyst 1",
    role: "member",
  },
  {
    email: "gkbuhrma@ncsu.edu",
    hash: "26077d289339a390726bcd297d9a9e2cfcbfe5a950e240a9bfcebe3f61543ff6",
    label: "Analyst 2",
    role: "member",
  },

 {
    email: "rrbarton@ncsu.edu",
    hash: "49109023f03e506488961169f6e09e826d8718f1799760761007c85c13b85079",
    label: "Guest",
    role: "guest",
  },
];

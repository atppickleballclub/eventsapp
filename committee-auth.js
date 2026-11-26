/* ATP Events committee sign-in, shared by committee.html and stats.html.
   Signs in with Firebase email + password. With "Keep me signed in" ticked it
   stays signed in on this phone (localStorage) until "Sign out"; otherwise
   only until the app or browser tab is closed (sessionStorage).
   Being on the committee is checked against config/committee -> emails.   */
const ATP_AUTH = (() => {
  const KEY = "AIzaSyAykyvBpr-3H4_gCm--8tDN2IhV-2EFfj0";
  const PROJECT = "atp-events";
  const S = [() => localStorage, () => sessionStorage];
  const ls = {
    // reads whichever store holds the sign-in
    get(k) { for (const st of S) { try { const v = st().getItem(k); if (v !== null) return v; } catch (e) {} } return null; },
    set(k, v) { const st = ls.remembered() ? S[0] : S[1]; try { st().setItem(k, v); } catch (e) {} },
    del(k) { S.forEach(st => { try { st().removeItem(k); } catch (e) {} }); },
    remembered() { try { return localStorage.getItem("atpCmRemember") === "1"; } catch (e) { return false; } }
  };
  const save = (idToken, refreshToken, expiresIn, email) => {
    ls.set("atpCmToken", idToken);
    ls.set("atpCmExp", String(Date.now() + (Number(expiresIn) - 60) * 1000));
    if (refreshToken) ls.set("atpCmRefresh", refreshToken);
    if (email) ls.set("atpCmEmail", email.toLowerCase());
  };

  // Error codes: "bad-login" (wrong email or password), "network".
  async function signIn(email, password, remember) {
    signOut();
    try { remember ? localStorage.setItem("atpCmRemember", "1") : localStorage.removeItem("atpCmRemember"); } catch (e) {}
    let r, j;
    try {
      r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, returnSecureToken: true })
      });
      j = await r.json();
    } catch (e) { throw new Error("network"); }
    if (!r.ok) {
      const code = (j.error && j.error.message) || "";
      if (/TOO_MANY_ATTEMPTS/.test(code)) throw new Error("too-many");
      // Only sent if Firebase's "email enumeration protection" is turned off;
      // with it on (the default) both come back as INVALID_LOGIN_CREDENTIALS.
      if (/EMAIL_NOT_FOUND|USER_DISABLED/.test(code)) throw new Error("bad-user");
      if (/INVALID_PASSWORD/.test(code)) throw new Error("bad-password");
      throw new Error("bad-login");
    }
    save(j.idToken, j.refreshToken, j.expiresIn, j.email);
    return j.idToken;
  }

  // A valid token, refreshing it quietly if it has expired. null = not signed in.
  async function token() {
    const t = ls.get("atpCmToken");
    if (t && Number(ls.get("atpCmExp") || 0) > Date.now()) return t;
    const rt = ls.get("atpCmRefresh");
    if (!rt) return null;
    try {
      const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${KEY}`, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(rt)
      });
      const j = await r.json();
      if (!r.ok) { signOut(); return null; }
      save(j.id_token, j.refresh_token, j.expires_in);
      return j.id_token;
    } catch (e) { return null; }   // offline: treat as signed out for now
  }

  // true / false: is the signed-in email on config/committee?
  async function isCommittee(tok) {
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/config/committee`,
      { headers: { Authorization: "Bearer " + tok } });
    if (r.status === 403 || r.status === 404) return false;   // rules only let committee read it
    if (!r.ok) throw new Error("network");
    const j = await r.json();
    const list = (j.fields?.emails?.arrayValue?.values || []).map(v => (v.stringValue || "").toLowerCase());
    return list.includes(email());
  }

  function email() { return ls.get("atpCmEmail") || ""; }
  function signOut() { ["atpCmToken", "atpCmExp", "atpCmRefresh", "atpCmEmail"].forEach(ls.del); }
  const MESSAGES = {
    "bad-login": "Incorrect email or password.",
    "bad-user": "Invalid user.",
    "bad-password": "Incorrect password.",
    "too-many": "Too many tries. Wait a few minutes and try again.",
    "network": "Couldn't reach the sign-in. Check your connection and try again.",
    "not-committee": "Invalid user. This login isn't set up for the committee area."
  };
  const message = e => MESSAGES[e && e.message] || MESSAGES["bad-login"];

  return { signIn, token, isCommittee, email, signOut, message, remembered: ls.remembered, KEY, PROJECT };
})();

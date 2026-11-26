# Kindee Chat Connectivity & Signed URL Root Cause Report

## Summary
- Browser evidence: 3 signed URL `GET /api/upload/signed-url` returned HTTP 200; images loaded HTTP 200. Signed URL refresh WORKS correctly.
- Console: `[ChatList] socket connected {connected: false}` appears twice (React StrictMode double-mount), never transitions to `true`. Socket connection not succeeding.
- Tests: Backend 302 passed / 0 failed; Frontend 254 passed / 0 failed.
- Frontend build: success (5.19s).

## Fix Applied
- `frontend/src/context/SocketContext.jsx`: Added `return () => { disconnectAll(); }` cleanup to `useEffect(() => { connect(); }, [connect])`. Previously sockets leaked on unmount (no disconnect on cleanup).

## Signed URLs — No Fix Needed
- Expired attachment URL → AttachmentImage.onError → getSignedUrl returns fresh signed URL → image loads HTTP 200.
- `extractStorageObjectPath` supports both legacy (`chat-attachments/chat-attachments/...`) and new path formats.
- `getSignedUrl` signs both new & legacy path candidates.
- No retry loop (retriedRef limits to 1). Error state shown on failure.

## Socket `connected: false` — Needs Backend Investigation
- Frontend socket code appears correct: SocketProvider creates sockets via `io(socketUrl || undefined, { path: "/socket.io", auth: { token }, ... })`.
- Vite proxy: `/socket.io` → `http://localhost:5000` with `ws: true`.
- Root cause not identified from frontend code alone. Likely backend auth/token issue, network, or CORS.
- Cannot perform live staging verification: no `.env` files, no staging credentials, no browser, no two test accounts.
- Recommendation: inspect backend `backend/services/socketService.js` auth middleware (Supabase getUser + JWT fallback), verify JWT token reaches server, check CORS/Socket.IO server config on `localhost:5000`, verify `SERVER_SOCKET_URL` env var resolves correctly in dev.

## Recommendations
1. Investigate `connected: false` at backend auth layer (socketService.js auth middleware).
2. Confirm Vite proxy WebSocket upgrade works (`ws: true`).
3. Re-run full test suite after backend fix.

// The chat room implementation lives in components/ChatRoom.jsx and is shared by
// the customer route (/messages/:conversationId) and the store-owner route
// (/selladmin/messages/:conversationId). Keep this re-export so any page-level
// import resolves to the same mode-aware component.
export { default, resolveChatMode } from "../components/ChatRoom";
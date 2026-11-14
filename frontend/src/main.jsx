import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import GoogleAuthWrapper from "./components/GoogleAuthWrapper";
import "leaflet/dist/leaflet.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <GoogleAuthWrapper>
      <App />
    </GoogleAuthWrapper>
  </React.StrictMode>
);

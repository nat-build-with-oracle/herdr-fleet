/** Mount point. Everything else in this directory is one module, one file;
 *  what the console shares with compare lives in ../shared. */
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./console.css";

const host = document.getElementById("root");
if (!host) throw new Error("#root is missing from the shell");
createRoot(host).render(<App />);

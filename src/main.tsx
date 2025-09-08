import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Radare2 from "./pages/r2";


ReactDOM.createRoot(document.getElementById("root")!).render(
  <>
    <style>{`
      html, body, #root { height: 100%; }
      html, body { margin: 0; padding: 0; overscroll-behavior: none; }
      /* Prevent page rubber-band; scroll within .app-root */
      body { position: fixed; inset: 0; overflow: hidden; }
      .app-root { height: 100vh; width: 100vw; overflow: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
    `}</style>
    <div className="app-root">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/r2" element={<Radare2 />} />
        </Routes>
      </BrowserRouter>
    </div>
  </>
);

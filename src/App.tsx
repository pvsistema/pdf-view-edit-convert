
import { Toaster } from "@/components/ui/toaster";
import { BrowserRouter, HashRouter, Routes, Route } from "react-router-dom";
import { isDesktop } from "@/lib/desktop";
import { lazy, Suspense } from "react";
import Index from "./pages/Index";

const Admin = lazy(() => import("./pages/Admin"));
const Thanks = lazy(() => import("./pages/Thanks"));
const NotFound = lazy(() => import("./pages/NotFound"));

const Router = isDesktop() ? HashRouter : BrowserRouter;

const App = () => (
  <>
    <Toaster />
    <Router>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/thanks" element={<Thanks />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Router>
  </>
);

export default App;
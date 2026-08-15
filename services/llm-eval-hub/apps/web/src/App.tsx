import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { Dashboard } from "./pages/Dashboard";
import { Datasets } from "./pages/Datasets";
import { Endpoints } from "./pages/Endpoints";
import { NewEvaluation } from "./pages/NewEvaluation";
import { RunDetail } from "./pages/RunDetail";
import { Runs } from "./pages/Runs";

export default function App() {
  return <Routes><Route element={<AppLayout />}><Route index element={<Dashboard />} /><Route path="endpoints" element={<Endpoints />} /><Route path="datasets" element={<Datasets />} /><Route path="evaluations/new" element={<NewEvaluation />} /><Route path="runs" element={<Runs />} /><Route path="runs/:runId" element={<RunDetail />} /><Route path="*" element={<Navigate to="/" replace />} /></Route></Routes>;
}

import { createBrowserRouter } from "react-router";
import { HomeScreen } from "../features/home/HomeScreen";
import { NotFoundScreen } from "../features/home/NotFoundScreen";
import { SettingsScreen } from "../features/settings/SettingsScreen";

export const router = createBrowserRouter([
  { path: "/", element: <HomeScreen /> },
  { path: "/settings", element: <SettingsScreen /> },
  { path: "*", element: <NotFoundScreen /> },
]);

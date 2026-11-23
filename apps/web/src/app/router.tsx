import { createBrowserRouter } from "react-router";
import { HomeScreen } from "../features/home/HomeScreen";
import { NotFoundScreen } from "../features/home/NotFoundScreen";

export const router = createBrowserRouter([
  { path: "/", element: <HomeScreen /> },
  { path: "*", element: <NotFoundScreen /> },
]);

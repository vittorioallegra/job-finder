import { createBrowserRouter } from "react-router";
import { HomeScreen } from "../features/home/HomeScreen";
import { NotFoundScreen } from "../features/home/NotFoundScreen";
import { OnboardingScreen } from "../features/onboarding/OnboardingScreen";
import { ProfileScreen } from "../features/profile/ProfileScreen";
import { SettingsScreen } from "../features/settings/SettingsScreen";

export const router = createBrowserRouter([
  { path: "/", element: <HomeScreen /> },
  { path: "/onboarding", element: <OnboardingScreen /> },
  { path: "/profile", element: <ProfileScreen /> },
  { path: "/settings", element: <SettingsScreen /> },
  { path: "*", element: <NotFoundScreen /> },
]);

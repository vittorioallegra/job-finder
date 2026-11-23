import { createBrowserRouter } from "react-router";
import { CompaniesScreen } from "../features/companies/CompaniesScreen";
import { HomeScreen } from "../features/home/HomeScreen";
import { JobsScreen } from "../features/jobs/JobsScreen";
import { NotFoundScreen } from "../features/home/NotFoundScreen";
import { OnboardingScreen } from "../features/onboarding/OnboardingScreen";
import { ProfileScreen } from "../features/profile/ProfileScreen";
import { SettingsScreen } from "../features/settings/SettingsScreen";

export const router = createBrowserRouter([
  { path: "/", element: <HomeScreen /> },
  { path: "/onboarding", element: <OnboardingScreen /> },
  { path: "/profile", element: <ProfileScreen /> },
  { path: "/companies", element: <CompaniesScreen /> },
  { path: "/jobs", element: <JobsScreen /> },
  { path: "/settings", element: <SettingsScreen /> },
  { path: "*", element: <NotFoundScreen /> },
]);

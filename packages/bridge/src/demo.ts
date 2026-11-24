import type { ApplicationDetail } from "./applications";
import type { CompanyRecord, JobListItem } from "./ingest";
import type { JobDetail } from "./jobs";
import { emptyProfile, type Profile } from "./profile";

/** Everything the demo shows, in the shapes the bridge hands to the renderer. */
export interface DemoDataset {
  profile: Profile;
  companies: CompanyRecord[];
  jobs: JobListItem[];
  /** Detail fields per job id, on top of the list item. */
  jobDetails: Record<string, Partial<JobDetail>>;
  /** Applications with their history; some point at jobs that are not in `jobs` (older postings). */
  applications: ApplicationDetail[];
}

/**
 * Made-up sample data for looking at the screens: the web dev renderer (`?demo`) and the desktop
 * app started with `JOB_FINDER_DEMO=1` both use it. Every company, person and posting is invented.
 */
export function demoDataset(now: number = Date.now()): DemoDataset {
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;

  const companies: CompanyRecord[] = [
    company("c1", "Fintra", "greenhouse", now - 30 * day, {
      outcome: "scanned",
      at: now - 2 * hour,
      jobCount: 14,
      closedCount: 1,
    }),
    company("c2", "Orbita Labs", "lever", now - 25 * day, {
      outcome: "scanned",
      at: now - 2 * hour,
      jobCount: 9,
      closedCount: 0,
    }),
    company("c3", "Vela Health", "ashby", now - 20 * day, {
      outcome: "scanned",
      at: now - 2 * hour,
      jobCount: 22,
      closedCount: 3,
    }),
    company("c4", "Pagoda", "personio", now - 12 * day, {
      outcome: "scanned",
      at: now - 2 * hour,
      jobCount: 5,
      closedCount: 0,
    }),
    company("c5", "Kairos", "workable", now - 9 * day, {
      outcome: "failed",
      at: now - 2 * hour,
      code: "board-not-found",
    }),
    company("c6", "Nordlicht", "recruitee", now - 4 * day, {
      outcome: "scanned",
      at: now - 2 * hour,
      jobCount: 7,
      closedCount: 2,
    }),
    company("c7", "Lumen Studio", null, now - day, null),
  ];

  const jobs: JobListItem[] = [
    job("j1", "Senior Frontend Engineer", "Fintra", ["Milan"], "hybrid", 92, now - 2 * day, {
      explanation:
        "Six years of React and TypeScript against the five asked for; design system work is listed as a plus.",
      isNew: true,
      applicationStatus: "preparing",
    }),
    job("j2", "Product Engineer, React", "Orbita Labs", ["Remote (EU)"], "remote", 88, now - day, {
      explanation:
        "Same stack as yours on a growing B2B product, with a team spread across Europe.",
      isNew: true,
    }),
    job(
      "j3",
      "Staff Engineer, Design Systems",
      "Vela Health",
      ["Berlin"],
      "remote",
      81,
      now - 5 * day,
      {
        explanation: "A lead role on the design system; asks for fluent English, which you have.",
        applicationStatus: "applied",
      },
    ),
    job("j4", "Full-stack Developer", "Pagoda", ["Turin"], "onsite", 74, now - 3 * hour, {
      explanation:
        "Strong match on the frontend; the Go backend is a skill you would still need to build.",
      isNew: true,
    }),
    job("j5", "Frontend Lead", "Kairos", ["Bologna"], "hybrid", 71, now - 6 * day, {
      explanation: "Leads a team of four; you have mentored engineers but not managed a team yet.",
      applicationStatus: "bookmarked",
    }),
    job("j6", "TypeScript Engineer", "Nordlicht", ["Remote"], "remote", 66, now - 7 * day, {
      explanation: "Compatible stack, but the posting is in German and asks for German at B2.",
    }),
    job("j7", "Mobile Engineer, React Native", "Fintra", ["Milan"], "hybrid", 58, now - 2 * day, {
      explanation: "Some React overlap, but most of the role is native iOS and Android work.",
      isNew: true,
    }),
    job("j8", "Platform Engineer", "Vela Health", ["Berlin", "London"], "hybrid", null, now - day, {
      isNew: true,
    }),
    job("j9", "Data Engineer", "Orbita Labs", [], "unknown", 34, now - 9 * day, {
      explanation:
        "The role centres on Spark and data pipelines, which your profile does not list.",
      dismissed: true,
    }),
  ];

  const jobDetails: Record<string, Partial<JobDetail>> = {
    j1: {
      description:
        "You will lead the web app for business payments, working closely with design and product.\n\nWhat you bring: React, TypeScript, testing, accessibility, REST and GraphQL APIs. Experience with a design system is a plus.",
      employmentType: "full-time",
      seniority: "senior",
      salary: { min: 55000, max: 70000, currency: "EUR", period: "year" },
      visaSponsorship: "no",
      language: "en",
      sources: [
        {
          source: "greenhouse",
          url: "https://example.com/jobs/fintra-senior-frontend",
          applyUrl: "https://example.com/jobs/fintra-senior-frontend/apply",
          closed: false,
          lastSeenAt: now - 2 * hour,
        },
      ],
    },
    j2: {
      description:
        "Join a small product team building the analytics workspace. You will ship features end to end in React and Node.",
      employmentType: "full-time",
      seniority: "mid",
      language: "en",
      remoteScope: "EU",
    },
  };

  const applications: ApplicationDetail[] = [
    application("a1", "j1", "Senior Frontend Engineer", "c1", "Fintra", "preparing", now, [
      ["bookmarked", null, now - 2 * day],
      ["preparing", "Tailoring the CV around the design system work.", now - day],
    ]),
    application("a2", "j3", "Staff Engineer, Design Systems", "c3", "Vela Health", "applied", now, [
      ["bookmarked", null, now - 6 * day],
      ["preparing", null, now - 5 * day],
      ["ready", null, now - 4 * day],
      ["applied", "Sent through their careers page.", now - 4 * day],
    ]),
    application("a3", "j5", "Frontend Lead", "c5", "Kairos", "bookmarked", now, [
      ["bookmarked", null, now - 3 * day],
    ]),
    application("a4", "j10", "UI Engineer", "c2", "Orbita Labs", "interviewing", now, [
      ["applied", null, now - 20 * day],
      ["interviewing", "First call went well; tech interview on Thursday.", now - 6 * day],
    ]),
    application("a5", "j11", "Frontend Developer", "c6", "Nordlicht", "rejected", now, [
      ["applied", null, now - 30 * day],
      ["rejected", "They went with a German-speaking candidate.", now - 18 * day],
    ]),
  ];

  return {
    profile: demoProfile(),
    companies,
    jobs,
    jobDetails,
    applications,
  };
}

function company(
  id: string,
  name: string,
  ats: string | null,
  createdAt: number,
  lastScan: CompanyRecord["lastScan"],
): CompanyRecord {
  const slug = name.toLowerCase().replace(/[^a-z]+/g, "-");
  return {
    id,
    name,
    careersUrl: `https://example.com/careers/${slug}`,
    ats,
    slug: ats ? slug : null,
    createdAt,
    lastScan,
  };
}

function job(
  id: string,
  title: string,
  companyName: string,
  locations: string[],
  workMode: string,
  score: number | null,
  firstSeenAt: number,
  extra: Partial<JobListItem> = {},
): JobListItem {
  return {
    id,
    title,
    companyName,
    locations,
    workMode,
    url: `https://example.com/jobs/${id}`,
    applyUrl: `https://example.com/jobs/${id}/apply`,
    postedAt: firstSeenAt,
    firstSeenAt,
    score,
    explanation: null,
    dismissed: false,
    isNew: false,
    applicationStatus: null,
    ...extra,
  };
}

function application(
  id: string,
  jobId: string,
  jobTitle: string,
  companyId: string,
  companyName: string,
  status: ApplicationDetail["status"],
  now: number,
  history: [ApplicationDetail["status"], string | null, number][],
): ApplicationDetail {
  const createdAt = history[0]?.[2] ?? now;
  const statusChangedAt = history[history.length - 1]?.[2] ?? now;
  return {
    id,
    jobId,
    jobTitle,
    companyId,
    companyName,
    status,
    createdAt,
    statusChangedAt,
    jobUrl: `https://example.com/jobs/${jobId}`,
    applyUrl: `https://example.com/jobs/${jobId}/apply`,
    events: history.map(([eventStatus, note, at], index) => ({
      id: `${id}-e${index + 1}`,
      status: eventStatus,
      note,
      at,
    })),
  };
}

function demoProfile(): Profile {
  return {
    ...emptyProfile(),
    contact: {
      fullName: "Alex Rossi",
      email: "alex.rossi@example.com",
      phone: "+39 000 000 0000",
      location: "Milan, Italy",
    },
    headline: "Senior frontend engineer",
    summary:
      "Frontend engineer with six years of React and TypeScript, focused on design systems and accessible interfaces.",
    experience: [
      {
        company: "Example Bank",
        title: "Senior Frontend Engineer",
        location: "Milan",
        startDate: "2022-03",
        endDate: "",
        bullets: [
          "Led the design system used by 6 product teams.",
          "Cut the main bundle size by 40% with route-level code splitting.",
        ],
      },
      {
        company: "Example Agency",
        title: "Frontend Developer",
        location: "Turin",
        startDate: "2019-01",
        endDate: "2022-02",
        bullets: ["Built React apps for retail and travel clients."],
      },
    ],
    education: [
      {
        institution: "Example University",
        degree: "MSc in Computer Engineering",
        grade: "",
        startDate: "2016",
        endDate: "2018",
      },
    ],
    skills: [
      { name: "React", level: "expert", aliases: ["React.js"] },
      { name: "TypeScript", level: "expert", aliases: ["TS"] },
      { name: "Accessibility", level: "advanced", aliases: ["a11y"] },
      { name: "Node.js", level: "intermediate", aliases: [] },
    ],
    languages: [
      { name: "Italian", level: "native" },
      { name: "English", level: "C1" },
    ],
    preferences: {
      roles: ["Senior Frontend Engineer", "Frontend Tech Lead"],
      locations: ["Milan", "Remote"],
      workModes: ["remote", "hybrid"],
      employmentTypes: ["full_time"],
      seniorities: ["senior", "lead"],
    },
  };
}

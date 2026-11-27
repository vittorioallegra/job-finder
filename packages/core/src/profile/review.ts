import type { Profile } from "./schema";
import type { ReviewSeverity, RuleFinding } from "./review-types";

/** A summary shorter than this reads as a placeholder. */
const MIN_SUMMARY_CHARS = 120;
/** Fewer skills than this leaves the matching with little to go on. */
const MIN_SKILLS = 5;
/** Bullets before the lack of any figure is worth saying. */
const MIN_BULLETS_FOR_NUMBERS = 3;

const SEVERITY_ORDER: Record<ReviewSeverity, number> = { high: 0, medium: 1, low: 2 };

/** A skill the postings for the profile's roles ask for, with how often. */
export interface MarketSkill {
  skill: string;
  /** Postings that name it. */
  jobs: number;
  /** Share of the postings read, 0 to 100. */
  percent: number;
}

/** Folds case, dots, spaces and hyphens, so "Node.js", "node js" and "NODE" compare equal. */
function fold(text: string): string {
  return text.toLowerCase().replace(/[.\s_-]+/g, "");
}

/** The text of the profile that talks about work: the summary and every experience. */
function workText(profile: Profile): string {
  return [
    profile.headline,
    profile.summary,
    ...profile.experience.flatMap((item) => [item.title, ...item.bullets]),
  ].join("\n");
}

/** Terms that are also plain words ("the rest of", "to excel"): only the exact spelling counts. */
const EXACT_CASE: ReadonlySet<string> = new Set([
  "REST",
  "Express",
  "Spring",
  "Swift",
  "Rails",
  "Oracle",
  "Ruby",
  "Helm",
  "Excel",
  "Agile",
  "Looker",
]);

/** Whether a skill is in the skill list (by name or alias) or named in the profile's own work text. */
export function profileHasSkill(profile: Profile, skill: string): boolean {
  const wanted = fold(skill);
  if (wanted === "") return false;
  for (const item of profile.skills) {
    if ([item.name, ...item.aliases].some((name) => fold(name) === wanted)) return true;
  }
  return mentions(workText(profile), skill);
}

/** True when `text` names `term` as a word of its own ("go" in "go to market" still counts: terms are chosen to avoid that). */
export function mentions(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, EXACT_CASE.has(term) ? "" : "i").test(
    text,
  );
}

function finding(
  code: RuleFinding["code"],
  section: RuleFinding["section"],
  severity: ReviewSeverity,
  params: RuleFinding["params"] = {},
): RuleFinding {
  return { code, section, severity, params };
}

/**
 * Checks of the profile that need no AI: what is empty, thin or unproven, and the skills the
 * postings for the profile's roles ask for that the profile never names. Most serious first.
 */
export function reviewProfileRules(profile: Profile, market: MarketSkill[] | null): RuleFinding[] {
  const found: RuleFinding[] = [];

  if (profile.headline.trim() === "") found.push(finding("no-headline", "headline", "high"));

  const summary = profile.summary.trim();
  if (summary === "") found.push(finding("no-summary", "summary", "high"));
  else if (summary.length < MIN_SUMMARY_CHARS) {
    found.push(finding("short-summary", "summary", "medium", { length: summary.length }));
  }

  if (profile.experience.length === 0) {
    found.push(finding("no-experience", "experience", "high"));
  } else {
    const withoutBullets = profile.experience.filter((item) => item.bullets.length === 0).length;
    if (withoutBullets > 0) {
      found.push(finding("experience-no-bullets", "experience", "high", { count: withoutBullets }));
    }
    const withoutDates = profile.experience.filter((item) => item.startDate.trim() === "").length;
    if (withoutDates > 0) {
      found.push(finding("experience-no-dates", "experience", "medium", { count: withoutDates }));
    }
    const bullets = profile.experience.flatMap((item) => item.bullets);
    if (bullets.length >= MIN_BULLETS_FOR_NUMBERS && !bullets.some((text) => /\d/.test(text))) {
      found.push(finding("no-numbers", "experience", "medium", { count: bullets.length }));
    }
  }

  if (profile.skills.length === 0) found.push(finding("no-skills", "skills", "high"));
  else if (profile.skills.length < MIN_SKILLS) {
    found.push(finding("few-skills", "skills", "medium", { count: profile.skills.length }));
  }
  const text = workText(profile);
  if (profile.experience.length > 0) {
    const unbacked = profile.skills
      .filter((item) => ![item.name, ...item.aliases].some((name) => mentions(text, name)))
      .map((item) => item.name);
    if (unbacked.length >= 3) {
      found.push(
        finding("unbacked-skills", "skills", "low", {
          count: unbacked.length,
          skills: unbacked.slice(0, 4).join(", "),
        }),
      );
    }
  }

  if (profile.languages.length === 0) found.push(finding("no-languages", "languages", "low"));
  if (profile.education.length === 0) found.push(finding("no-education", "education", "low"));
  if (profile.links.length === 0) found.push(finding("no-links", "links", "low"));
  if (profile.preferences.roles.length === 0)
    found.push(finding("no-roles", "preferences", "high"));
  if (profile.preferences.locations.length === 0) {
    found.push(finding("no-places", "preferences", "medium"));
  }

  for (const item of market ?? []) {
    if (profileHasSkill(profile, item.skill)) continue;
    found.push(
      finding("market-skill-missing", "skills", item.percent >= 40 ? "high" : "medium", {
        skill: item.skill,
        percent: item.percent,
        jobs: item.jobs,
      }),
    );
  }

  return found.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/**
 * Terms of the trade, searched in the postings for the profile's roles. Chosen to be unambiguous as
 * words ("Go" and "R" are left out: they are everywhere in plain text).
 */
export const SKILL_VOCABULARY: readonly string[] = [
  "JavaScript",
  "TypeScript",
  "React",
  "Vue",
  "Angular",
  "Next.js",
  "Node.js",
  "NestJS",
  "Express",
  "GraphQL",
  "REST",
  "HTML",
  "CSS",
  "Sass",
  "Tailwind",
  "Redux",
  "Webpack",
  "Vite",
  "Storybook",
  "React Native",
  "Flutter",
  "Swift",
  "Kotlin",
  "iOS",
  "Android",
  "Python",
  "Django",
  "Flask",
  "FastAPI",
  "Java",
  "Spring",
  "Scala",
  "C#",
  ".NET",
  "C++",
  "Rust",
  "PHP",
  "Laravel",
  "Symfony",
  "Ruby",
  "Rails",
  "Golang",
  "Elixir",
  "SQL",
  "PostgreSQL",
  "MySQL",
  "MongoDB",
  "Redis",
  "Elasticsearch",
  "DynamoDB",
  "Oracle",
  "Kafka",
  "RabbitMQ",
  "Docker",
  "Kubernetes",
  "Terraform",
  "Ansible",
  "Helm",
  "AWS",
  "Azure",
  "GCP",
  "Linux",
  "Git",
  "CI/CD",
  "Jenkins",
  "GitLab",
  "GitHub Actions",
  "Microservices",
  "Agile",
  "Scrum",
  "TDD",
  "Jest",
  "Cypress",
  "Playwright",
  "Selenium",
  "JUnit",
  "Prometheus",
  "Grafana",
  "Datadog",
  "OpenTelemetry",
  "Machine Learning",
  "TensorFlow",
  "PyTorch",
  "Pandas",
  "NumPy",
  "Spark",
  "Airflow",
  "dbt",
  "Snowflake",
  "BigQuery",
  "Power BI",
  "Tableau",
  "Looker",
  "Excel",
  "SAP",
  "Salesforce",
  "ServiceNow",
  "Jira",
  "Figma",
  "OAuth",
  "Cybersecurity",
];

/** Postings that must be read before a share means anything. */
export const MIN_MARKET_JOBS = 20;
/** A skill must be in at least this share of the postings to be called out. */
export const MIN_MARKET_PERCENT = 25;
/** Skills called out at most. */
export const MAX_MARKET_SKILLS = 5;

/**
 * The skills of `SKILL_VOCABULARY` that at least `MIN_MARKET_PERCENT` of the given posting texts name
 * and the profile does not, most asked first. Nothing when too few postings were read.
 */
export function marketSkillGaps(profile: Profile, jobTexts: string[]): MarketSkill[] {
  if (jobTexts.length < MIN_MARKET_JOBS) return [];
  const gaps: MarketSkill[] = [];
  for (const skill of SKILL_VOCABULARY) {
    if (profileHasSkill(profile, skill)) continue;
    const jobs = jobTexts.filter((text) => mentions(text, skill)).length;
    const percent = Math.round((jobs / jobTexts.length) * 100);
    if (percent >= MIN_MARKET_PERCENT) gaps.push({ skill, jobs, percent });
  }
  return gaps.sort((a, b) => b.percent - a.percent).slice(0, MAX_MARKET_SKILLS);
}

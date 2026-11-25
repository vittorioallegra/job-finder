# Finding companies: sources and free keys

The app does not read job sites. It finds **companies**, locates each one's public job board (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Personio, Recruitee, Teamtailor), and scans those boards. A company search runs from Sources, on a schedule, and after the profile changes. It works the same for any country: the places in the profile only steer where it looks.

## What runs

| Source                                                       | Key                 | What it adds                                                  |
| ------------------------------------------------------------ | ------------------- | ------------------------------------------------------------- |
| Web search (DuckDuckGo by default, or Brave, Tavily, Serper) | none, or a free key | Boards named in search results for the roles and places       |
| Common Crawl URL index                                       | none                | A sample of ATS board addresses                               |
| Workable job directory (`jobs.workable.com`)                 | none                | Companies hiring in each country of the places, for each role |
| Himalayas, Remotive, Arbeitnow                               | none                | Companies named in remote and European job APIs               |

Job feeds (Himalayas, Remotive, Arbeitnow) give company names, not boards. Each name is turned into board names, tried on every provider, and kept only when the board proves to be that company's: its own name matches, or (for Lever, Ashby, Personio, which carry no company name) it has a job with the title the feed gave. Up to 40 companies are looked up per run, and a name is looked up once per session. Postings from a feed are never stored; they only say which companies to read.

## Free keys

### Web search keys (optional, more reliable than DuckDuckGo)

- Brave Search: <https://api-dashboard.search.brave.com>
- Tavily: <https://app.tavily.com>
- Serper: <https://serper.dev>

Create an account, copy the key from its dashboard, choose the service in Settings, "Finding companies", and paste the key. One search service is used at a time.

## Politeness

All requests go through the shared HTTP client: one request per second per host, robots.txt respected, the Workable directory read only through its open API paths. Remotive asks for few requests: a run makes one per keyword.

## Company registry and careers pages

The web search finds boards named in results; it cannot know a company's country. DBpedia (the open data extracted from Wikipedia, whose robots.txt leaves its SPARQL endpoint open) can: its company entries carry the country and the website. For each country in the places, the app asks it once, then reads up to 40 company sites per run, 5 at a time, one request a second per host. From each site's home page it finds the careers link in several languages, then the ATS board the page embeds or links; when the site has no ATS the careers page itself becomes the source, read later by the generic careers reader (which uses the configured AI). Companies already followed and sites read earlier in the session are skipped. Coverage is what Wikipedia knows of the country: the larger employers, in every industry. Wikidata's query service is not used: its robots.txt disallows it.

## Postings straight from a directory

Workable's job directory also lists the postings, with description, place and company. A company search stores them directly (up to 800 per run) under one company per name, so no board has to be found first. Those companies are not listed on the Sources page and are never scanned; a posting the directory stops listing for 30 days is closed.

## Wide scan of the community board lists

The Feashliaa/job-board-aggregator project publishes, rebuilt daily from Common Crawl, the board names of tens of thousands of companies on Greenhouse, Lever, Ashby and Workday (its data is CC BY-NC 4.0: non-commercial use). After each profile search the app reads the next 2000 boards of those lists, keeps only the postings located in the profile's places (or remote with a scope that reaches them), and stores them under hidden companies, as for the Workable directory. The place in the lists is kept in the setting `directory.wide-scan.cursor`, so repeated searches walk all the lists. Postings no scan lists for 30 days are closed. A name in the lists may be stale: a board that does not answer gives nothing.

Himalayas (remote postings open to a country) and Arbeitnow (Germany and its neighbours) postings are stored by the company search, only those in the places.

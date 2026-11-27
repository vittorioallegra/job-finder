import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
  type ParagraphChild,
} from "docx";
import { joinPresent } from "../documents/render";
import { shortUrl, type CvModel, type CvSection } from "./cv";

const FONT = "Calibri";
/** Half-points: Word sizes text in them. */
const BODY = 18;
const SMALL = 17;
const NAVY = "1B2A49";
const ACCENT = "2C5282";
const MUTED = "6B7280";
const GREY = "4B5563";
const TEXT = "1F2937";

/**
 * Word's language tag for a CV language: it drives spell checking and hyphenation. A language not
 * listed here uses its own code, which Word reads as that language in general.
 */
const LANGUAGE_TAGS: Record<string, string> = { en: "en-GB", it: "it-IT" };

interface RunOptions {
  bold?: boolean;
  italics?: boolean;
  size?: number;
  color?: string;
  allCaps?: boolean;
  characterSpacing?: number;
}

function run(value: string, options: RunOptions = {}): TextRun {
  return new TextRun({ text: value, font: FONT, size: BODY, color: TEXT, ...options });
}

function heading(value: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    keepNext: true,
    spacing: { before: 220, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: NAVY, space: 1 } },
    children: [
      run(value, { bold: true, size: 19, color: NAVY, allCaps: true, characterSpacing: 10 }),
    ],
  });
}

function sectionParagraphs(section: CvSection): Paragraph[] {
  const out: Paragraph[] = [heading(section.heading)];
  if (section.kind === "text") {
    out.push(new Paragraph({ spacing: { after: 40 }, children: [run(section.text)] }));
  } else if (section.kind === "items") {
    out.push(new Paragraph({ spacing: { after: 40 }, children: [run(section.items.join(", "))] }));
  } else if (section.kind === "pairs") {
    const children: ParagraphChild[] = [];
    section.pairs.forEach((pair, index) => {
      if (index > 0) children.push(run("    "));
      children.push(run(pair.label, { bold: true }));
      if (pair.value !== "") children.push(run(`: ${pair.value}`));
    });
    out.push(new Paragraph({ spacing: { after: 40 }, children }));
  } else {
    for (const entry of section.entries) {
      const title: ParagraphChild[] = [run(entry.title, { bold: true, size: 18 })];
      if (entry.company !== "") {
        title.push(run(" — ", { bold: true }), run(entry.company, { bold: true, color: ACCENT }));
      }
      out.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          keepNext: true,
          spacing: { before: 120, after: 0 },
          children: title,
        }),
      );
      if (entry.meta !== "") {
        out.push(
          new Paragraph({
            keepNext: entry.bullets.length > 0,
            spacing: { after: 30 },
            children: [run(entry.meta, { italics: true, color: MUTED, size: SMALL })],
          }),
        );
      }
      for (const bullet of entry.bullets) {
        out.push(
          new Paragraph({
            numbering: { reference: "bullets", level: 0 },
            spacing: { after: 20 },
            children: [run(bullet)],
          }),
        );
      }
    }
  }
  return out;
}

function linkRuns(links: CvModel["links"]): ParagraphChild[] {
  const runs: ParagraphChild[] = [];
  links.forEach((link, index) => {
    if (index > 0) runs.push(run(" | ", { color: GREY, size: SMALL }));
    runs.push(
      new ExternalHyperlink({
        link: link.url,
        children: [run(shortUrl(link.url), { color: GREY, size: SMALL })],
      }),
    );
  });
  return runs;
}

/**
 * The CV as a Word file (.docx): real headings, bullet lists and paragraphs, one column, no
 * tables or text boxes, so applicant tracking systems and Word itself read it the way the PDF
 * reads. Built from the same `CvModel` as the PDF page, with the same look.
 */
export async function buildCvDocx(
  cv: CvModel,
  language: string,
  title: string,
): Promise<Uint8Array> {
  const header: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 0 },
      children: [run(cv.name, { bold: true, size: 40, color: NAVY })],
    }),
  ];
  if (cv.headline !== "") {
    header.push(
      new Paragraph({
        spacing: { before: 40 },
        children: [run(cv.headline, { bold: true, size: 20, color: GREY })],
      }),
    );
  }
  if (cv.contact !== "") {
    header.push(
      new Paragraph({
        spacing: { before: 40 },
        children: [run(cv.contact, { color: GREY, size: SMALL })],
      }),
    );
  }
  if (cv.links.length > 0) {
    header.push(new Paragraph({ spacing: { before: 20 }, children: linkRuns(cv.links) }));
  }

  const document = new Document({
    title: joinPresent([cv.name, title], " — "),
    // The author is the CV's own name.
    creator: cv.name,
    styles: {
      default: {
        document: {
          run: { font: FONT, size: BODY, language: { value: LANGUAGE_TAGS[language] ?? language } },
        },
      },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: FONT, bold: true, size: 40, color: NAVY },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: FONT, bold: true, size: 19, color: NAVY },
        },
        {
          id: "Heading3",
          name: "Heading 3",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: FONT, bold: true, size: 18, color: TEXT },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 300, hanging: 220 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          // A4 with 13 mm and 15 mm margins, as the PDF.
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 737, right: 850, bottom: 737, left: 850 },
          },
        },
        children: [...header, ...cv.sections.flatMap(sectionParagraphs)],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}

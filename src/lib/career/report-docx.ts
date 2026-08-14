import {
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import { buildCareerReportMarkdown, type CareerReportData } from './report';

const fonts = { ascii: 'Aptos', hAnsi: 'Aptos', eastAsia: 'Microsoft YaHei', cs: 'Aptos' };

function textRun(text: string, options?: { bold?: boolean; italics?: boolean; color?: string }) {
  return new TextRun({ text, font: fonts, size: 22, ...options });
}

function markdownParagraph(line: string): Paragraph {
  if (line.startsWith('# ')) {
    return new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: line.slice(2), font: fonts, bold: true, color: '2563EB', size: 44 })],
      spacing: { after: 320 },
    });
  }
  if (line.startsWith('## ')) {
    return new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: line.slice(3), font: fonts, bold: true, size: 30 })],
      spacing: { before: 280, after: 120 },
      border: { bottom: { style: BorderStyle.SINGLE, color: 'D4D4D8', size: 4 } },
    });
  }
  if (line.startsWith('### ')) {
    return new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: line.slice(4), font: fonts, bold: true, size: 25 })],
      spacing: { before: 180, after: 80 },
    });
  }
  if (line.startsWith('> ')) {
    return new Paragraph({
      children: [textRun(line.slice(2), { italics: true, color: '52525B' })],
      spacing: { before: 260, after: 100, line: 330 },
      border: { left: { style: BorderStyle.SINGLE, color: '3B82F6', size: 14, space: 10 } },
    });
  }
  if (line.startsWith('- [')) {
    const completed = line.startsWith('- [x]');
    return new Paragraph({
      children: [textRun(`${completed ? '☑' : '☐'} ${line.slice(6)}`)],
      indent: { left: 360 },
      spacing: { after: 60, line: 330 },
    });
  }
  if (line.startsWith('- ')) {
    return new Paragraph({
      children: [textRun(line.slice(2))],
      bullet: { level: 0 },
      spacing: { after: 60, line: 330 },
    });
  }
  return new Paragraph({
    children: line ? [textRun(line)] : [],
    spacing: { after: line ? 80 : 40, line: 330 },
  });
}

export async function buildCareerReportDocx(
  data: CareerReportData,
  locale: string,
): Promise<Buffer> {
  const paragraphs = buildCareerReportMarkdown(data, locale)
    .split('\n')
    .map(markdownParagraph);
  const document = new Document({
    creator: 'CareerPilot',
    title: locale.startsWith('zh') ? 'CareerPilot 职业规划报告' : 'CareerPilot Career Planning Report',
    description: 'Career planning report exported by CareerPilot',
    styles: {
      default: {
        document: { run: { font: fonts, size: 22 } },
      },
    },
    sections: [{
      properties: {
        page: { margin: { top: 1_000, right: 1_000, bottom: 1_000, left: 1_000 } },
      },
      children: paragraphs,
    }],
  });
  return Packer.toBuffer(document);
}

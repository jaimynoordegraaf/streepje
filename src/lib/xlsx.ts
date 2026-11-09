/**
 * Een kleine schrijver voor .xlsx-bestanden, in pure JavaScript.
 *
 * Een .xlsx is een zip met een handjevol XML-bestanden. Er is bewust geen
 * pakket voor genomen: elk pakket met zip of xlsx erin brengt native of grote
 * code mee, en een export mag via een gewone update de telefoons op. Dit hier
 * doet precies wat het logboek nodig heeft en niets meer: tabbladen met een
 * vaste kopregel, een autofilter, en cellen die echte tekst, getallen, datums,
 * tijden of bedragen zijn (geen tekst die er alleen zo uitziet).
 *
 * Er staat niets van Expo in, zodat het in gewone Node te testen is.
 */

export type ColumnKind = 'text' | 'date' | 'time' | 'integer' | 'money';

export type Column = {
  title: string;
  kind: ColumnKind;
  /** Breedte in tekens, grofweg. */
  width: number;
};

/**
 * Wat een cel kan zijn. Voor 'date' en 'time' geef je een tijdstip in
 * milliseconden (zoals Date.now()), voor 'money' een bedrag in centen: de
 * schrijver rekent zelf om naar wat Excel verwacht. Null is een lege cel.
 */
export type CellValue = string | number | null;

export type Sheet = {
  name: string;
  columns: Column[];
  rows: CellValue[][];
  /**
   * De kopregel blijft staan bij scrollen en krijgt filterpijltjes. De
   * kopregel zelf staat er altijd; standaard aan.
   */
  filter?: boolean;
};

// ---------------------------------------------------------------------------
// Datums en getallen zoals Excel ze opslaat.

const MS_PER_DAY = 86_400_000;
// Excel telt dagen vanaf 30 december 1899; 1 januari 1970 is dag 25569.
const EXCEL_UNIX_EPOCH = 25569;

/** Lokale datum als Excel-dagnummer (geheel getal). */
export function excelDate(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY + EXCEL_UNIX_EPOCH;
}

/** Lokale tijd van de dag als deel van een etmaal (0 tot 1). */
export function excelTime(timestamp: number): number {
  const date = new Date(timestamp);
  return (date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()) / 86400;
}

/** Centen naar euro's, zonder dat 0,1 + 0,2 gaat afwijken. */
const euros = (cents: number) => Math.round(cents) / 100;

// ---------------------------------------------------------------------------
// XML

/** Tekens die in XML 1.0 niet mogen voorkomen, ook niet als &#...;. */
// eslint-disable-next-line no-control-regex
const ILLEGAL_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function escapeXml(text: string): string {
  return text
    .replace(ILLEGAL_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** A, B, ... Z, AA, AB, ... */
export function columnLetter(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

// De opmaakstijlen. De index is wat een cel in `s="..."` meegeeft.
const STYLE = { default: 0, header: 1, date: 2, time: 3, money: 4, integer: 5 } as const;
const STYLE_OF_KIND: Record<ColumnKind, number> = {
  text: STYLE.default,
  date: STYLE.date,
  time: STYLE.time,
  money: STYLE.money,
  integer: STYLE.integer,
};

const STYLES_XML =
  XML_HEAD +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="3">' +
  '<numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/>' +
  '<numFmt numFmtId="165" formatCode="hh:mm"/>' +
  '<numFmt numFmtId="166" formatCode="&quot;€ &quot;#,##0.00;&quot;€ &quot;\\-#,##0.00"/>' +
  '</numFmts>' +
  '<fonts count="2">' +
  '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '</fonts>' +
  '<fills count="3">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFE8E8EC"/><bgColor indexed="64"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="2">' +
  '<border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border><left/><right/><top/><bottom style="thin"><color rgb="FF888888"/></bottom><diagonal/></border>' +
  '</borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="6">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/** Een getal zoals XML het wil: punt als decimaalteken, nooit "1e-7" of "NaN". */
function numberText(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const text = String(value);
  if (!/e/i.test(text)) return text;
  return value.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Bouwt het XML van één tabblad. Tekst gaat via `strings` (de gedeelde
 * tekstentabel) in plaats van in de cel zelf: dat is wat Excel zelf doet, en
 * wat Numbers en Google Sheets het best lezen.
 */
function sheetXml(sheet: Sheet, strings: SharedStrings, selected: boolean): string {
  const header = sheet.filter !== false;
  const columns = sheet.columns;
  const lastColumn = columnLetter(columns.length - 1);
  const rowsTotal = sheet.rows.length + 1;

  const rows: string[] = [];

  const headerCells = columns
    .map(
      (column, index) =>
        `<c r="${columnLetter(index)}1" s="${STYLE.header}" t="s"><v>${strings.index(column.title)}</v></c>`
    )
    .join('');
  rows.push(`<row r="1">${headerCells}</row>`);

  sheet.rows.forEach((row, rowIndex) => {
    const r = rowIndex + 2;
    const cells: string[] = [];
    columns.forEach((column, columnIndex) => {
      const value = row[columnIndex] ?? null;
      if (value === null || value === '') return;
      const ref = `${columnLetter(columnIndex)}${r}`;
      const style = STYLE_OF_KIND[column.kind];
      if (column.kind === 'text') {
        cells.push(`<c r="${ref}" t="s"><v>${strings.index(String(value))}</v></c>`);
        return;
      }
      const number = typeof value === 'number' ? value : Number(value);
      const converted =
        column.kind === 'date'
          ? excelDate(number)
          : column.kind === 'time'
            ? excelTime(number)
            : column.kind === 'money'
              ? euros(number)
              : number;
      cells.push(`<c r="${ref}" s="${style}"><v>${numberText(converted)}</v></c>`);
    });
    rows.push(`<row r="${r}">${cells.join('')}</row>`);
  });

  const cols = columns
    .map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`)
    .join('');

  const pane = header
    ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>'
    : '';

  return (
    XML_HEAD +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="A1:${lastColumn}${rowsTotal}"/>` +
    `<sheetViews><sheetView${selected ? ' tabSelected="1"' : ''} workbookViewId="0">${pane}</sheetView></sheetViews>` +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    `<cols>${cols}</cols>` +
    `<sheetData>${rows.join('')}</sheetData>` +
    (header ? `<autoFilter ref="A1:${lastColumn}${rowsTotal}"/>` : '') +
    '</worksheet>'
  );
}

class SharedStrings {
  private readonly map = new Map<string, number>();
  private readonly list: string[] = [];
  /** Hoe vaak een tekst in een cel staat, voor het `count`-attribuut. */
  private uses = 0;

  index(text: string): number {
    this.uses += 1;
    const known = this.map.get(text);
    if (known !== undefined) return known;
    this.map.set(text, this.list.length);
    this.list.push(text);
    return this.list.length - 1;
  }

  xml(): string {
    const items = this.list
      .map((text) => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`)
      .join('');
    return (
      XML_HEAD +
      `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${this.uses}" uniqueCount="${this.list.length}">${items}</sst>`
    );
  }
}

/** De losse bestanden van de .xlsx, als naam en tekst. */
export function xlsxParts(sheets: Sheet[]): { name: string; text: string }[] {
  const strings = new SharedStrings();
  const sheetFiles = sheets.map((sheet, index) => ({
    name: `xl/worksheets/sheet${index + 1}.xml`,
    text: sheetXml(sheet, strings, index === 0),
  }));

  const filtered = sheets
    .map((sheet, index) => ({ sheet, index }))
    .filter(({ sheet }) => sheet.filter !== false);
  // Excel zoekt bij een autofilter een verborgen naam; zonder hem opent het
  // bestand wel, maar sommige versies klagen over "inhoud herstellen".
  const definedNames = filtered.length
    ? '<definedNames>' +
      filtered
        .map(
          ({ sheet, index }) =>
            `<definedName name="_xlnm._FilterDatabase" localSheetId="${index}" hidden="1">${escapeXml(
              `'${sheet.name.replace(/'/g, "''")}'`
            )}!$A$1:$${columnLetter(sheet.columns.length - 1)}$${sheet.rows.length + 1}</definedName>`
        )
        .join('') +
      '</definedNames>'
    : '';

  const workbook =
    XML_HEAD +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<bookViews><workbookView/></bookViews>' +
    '<sheets>' +
    sheets
      .map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
      .join('') +
    '</sheets>' +
    definedNames +
    '</workbook>';

  const workbookRels =
    XML_HEAD +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
      )
      .join('') +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
    '</Relationships>';

  const contentTypes =
    XML_HEAD +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets
      .map(
        (_, index) =>
          `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      )
      .join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
    '</Types>';

  const rootRels =
    XML_HEAD +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  return [
    { name: '[Content_Types].xml', text: contentTypes },
    { name: '_rels/.rels', text: rootRels },
    { name: 'xl/workbook.xml', text: workbook },
    { name: 'xl/_rels/workbook.xml.rels', text: workbookRels },
    { name: 'xl/styles.xml', text: STYLES_XML },
    ...sheetFiles,
    // De gedeelde teksten staan pas klaar nadat alle tabbladen gebouwd zijn.
    { name: 'xl/sharedStrings.xml', text: strings.xml() },
  ];
}

// ---------------------------------------------------------------------------
// De zip

/** UTF-8, zelf geschreven: TextEncoder is niet overal in React Native. */
export function utf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    // Een surrogaatpaar is één teken buiten het basisvlak (bijvoorbeeld een emoji).
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      }
    }
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return Uint8Array.from(bytes);
}

let crcTable: Uint32Array | null = null;

export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Datum en tijd in de twee 16-bit velden die zip gebruikt (vanaf 1980). */
function dosStamp(at: Date): { time: number; date: number } {
  const year = Math.max(1980, at.getFullYear());
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

/**
 * Een zip zonder compressie ("stored"). Groter dan een gecomprimeerde, maar
 * een logboek is maar enkele honderden kilobytes, en het scheelt een
 * compressiebibliotheek.
 */
export function zipStored(files: { name: string; data: Uint8Array }[], at = new Date()): Uint8Array {
  const stamp = dosStamp(at);
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const header = (size: number) => {
    const bytes = new Uint8Array(size);
    return { bytes, view: new DataView(bytes.buffer) };
  };

  for (const file of files) {
    const name = utf8(file.name);
    const crc = crc32(file.data);

    const local = header(30 + name.length);
    local.view.setUint32(0, 0x04034b50, true); // handtekening: lokale kop
    local.view.setUint16(4, 20, true); // versie die dit nodig heeft
    local.view.setUint16(6, 0x0800, true); // bit 11: namen zijn UTF-8
    local.view.setUint16(8, 0, true); // methode 0: geen compressie
    local.view.setUint16(10, stamp.time, true);
    local.view.setUint16(12, stamp.date, true);
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, file.data.length, true); // gecomprimeerd
    local.view.setUint32(22, file.data.length, true); // echt
    local.view.setUint16(26, name.length, true);
    local.view.setUint16(28, 0, true); // extra veld
    local.bytes.set(name, 30);
    chunks.push(local.bytes, file.data);

    const entry = header(46 + name.length);
    entry.view.setUint32(0, 0x02014b50, true); // handtekening: centrale map
    entry.view.setUint16(4, 20, true); // gemaakt met versie
    entry.view.setUint16(6, 20, true); // nodig: versie
    entry.view.setUint16(8, 0x0800, true);
    entry.view.setUint16(10, 0, true);
    entry.view.setUint16(12, stamp.time, true);
    entry.view.setUint16(14, stamp.date, true);
    entry.view.setUint32(16, crc, true);
    entry.view.setUint32(20, file.data.length, true);
    entry.view.setUint32(24, file.data.length, true);
    entry.view.setUint16(28, name.length, true);
    // 30 t/m 41: extra veld, commentaar, schijfnummer, attributen: allemaal nul.
    entry.view.setUint32(42, offset, true); // waar de lokale kop begint
    entry.bytes.set(name, 46);
    central.push(entry.bytes);

    offset += local.bytes.length + file.data.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = header(22);
  end.view.setUint32(0, 0x06054b50, true); // handtekening: einde
  end.view.setUint16(8, files.length, true);
  end.view.setUint16(10, files.length, true);
  end.view.setUint32(12, centralSize, true);
  end.view.setUint32(16, offset, true);

  const parts = [...chunks, ...central, end.bytes];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of parts) {
    out.set(part, position);
    position += part.length;
  }
  return out;
}

/** De hele .xlsx als bytes, klaar om weg te schrijven. */
export function buildXlsx(sheets: Sheet[], at = new Date()): Uint8Array {
  return zipStored(
    xlsxParts(sheets).map((part) => ({ name: part.name, data: utf8(part.text) })),
    at
  );
}

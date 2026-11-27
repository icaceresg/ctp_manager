export const SANCTION_SCOPES = ['ranked', 'circuit'];
export const SANCTION_PAGE_SIZE = 25;
export const SANCTION_PDF_BYTES = 2 * 1024 * 1024;
export const SANCTION_PDF_TYPE = 'application/pdf';
export const SANCTION_NAME_LENGTH = 100;
export const SANCTION_TEXT_LENGTH = 4000;

export function sanctionFileName(value) {
  return typeof value === 'string' && value.length >= 5 && value.length <= 160 && /\.pdf$/iu.test(value)
    && !/[/\\\u0000-\u001f\u007f]/u.test(value) && value.trim() === value;
}

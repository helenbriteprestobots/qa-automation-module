import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { FormSummary } from '@ctp/shared';

/** The Salud booking form inside the chatbot code (prestobotsv3). */
export const BOOKING_FORM_PATH = 'functions/src/products/salud/flows/turnos/flow.json';

/** Components where the patient types or picks something. */
const INPUT_TYPES = new Set(['TextInput', 'TextArea', 'Dropdown', 'DatePicker', 'CalendarPicker', 'RadioButtonsGroup', 'CheckboxGroup', 'NavigationList', 'ChipsSelector', 'OptIn']);

const fieldsOf = (node: unknown, out: string[]): string[] => {
  if (Array.isArray(node)) node.forEach((child) => fieldsOf(child, out));
  else if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (typeof record.type === 'string' && INPUT_TYPES.has(record.type) && typeof record.label === 'string' && !record.label.includes('${')) {
      if (!out.includes(record.label)) out.push(record.label);
    }
    Object.values(record).forEach((child) => fieldsOf(child, out));
  }
  return out;
};

/**
 * Reads the WhatsApp booking form from the local copy of the chatbot code. Returns undefined when the
 * folder or file is not there: the form is extra context for the AI, never required.
 */
export const readBookingForm = async (repoDir: string): Promise<FormSummary | undefined> => {
  let json: { screens?: Array<{ id?: string; title?: string; layout?: unknown }> };
  try {
    json = JSON.parse(await readFile(join(repoDir, BOOKING_FORM_PATH), 'utf8'));
  } catch {
    return undefined;
  }
  const screens = (json.screens ?? []).map((screen) => ({
    id: screen.id ?? '?',
    title: screen.title ?? screen.id ?? '?',
    fields: fieldsOf(screen.layout, []),
  }));
  return screens.length > 0 ? { name: 'Sacar turno (booking)', screens } : undefined;
};

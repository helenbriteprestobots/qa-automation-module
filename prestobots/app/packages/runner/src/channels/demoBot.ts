import type { ChatAuthor, ChatKind, ChatOption } from '@ctp/shared';

import { normalizeText } from '../text.ts';

/**
 * A tiny scripted bot that imitates the shape of the Cauce chatbot (menu, booking, my
 * appointments, cancel, hand-over). It lets anyone try the platform without access to salud-stage.
 *
 * It is NOT the real chatbot. It has one gap on purpose: it does not understand "quiero cancelar mi
 * turno" written as text (only through the menu), so the demo shows what a failed test looks like.
 */

export interface DemoReply {
  from: ChatAuthor;
  kind: ChatKind;
  text: string;
  options: ChatOption[];
}

type DemoState = 'start' | 'menu' | 'specialty' | 'slot' | 'appointment' | 'confirmCancel';

interface Appointment {
  specialty: string;
  slot: string;
}

const MENU: ChatOption[] = [
  { id: 'menu_book', title: 'Sacar turno' },
  { id: 'menu_mine', title: 'Mis turnos' },
  { id: 'menu_human', title: 'Hablar con una persona' },
];

const SPECIALTIES: ChatOption[] = [
  { id: 'spec_cardio', title: 'Cardiología' },
  { id: 'spec_clinica', title: 'Clínica médica' },
  { id: 'spec_pediatria', title: 'Pediatría' },
];

const SLOTS: ChatOption[] = [
  { id: 'slot_1', title: 'Martes 10:00' },
  { id: 'slot_2', title: 'Miércoles 15:30' },
  { id: 'slot_3', title: 'Jueves 09:00' },
];

const text = (value: string): DemoReply => ({ from: 'bot', kind: 'text', text: value, options: [] });
const buttons = (value: string, options: ChatOption[]): DemoReply => ({
  from: 'bot',
  kind: 'buttons',
  text: value,
  options,
});
const list = (value: string, options: ChatOption[]): DemoReply => ({
  from: 'bot',
  kind: 'list',
  text: value,
  options,
});
const menu = (): DemoReply => buttons('¿En qué te puedo ayudar?', MENU);

export class DemoBot {
  private state: DemoState = 'start';
  private appointment: Appointment | null = { specialty: 'Cardiología', slot: 'martes 10:00' };
  private pendingSpecialty: string | null = null;

  /** Replies to a text (optionId undefined) or to a tapped option. */
  reply(input: { text: string; optionId?: string }): DemoReply[] {
    const t = normalizeText(input.text);
    const id = input.optionId;

    if (id === 'menu_human' || /\b(persona|humano|operador|asesor)/.test(t)) {
      this.state = 'menu';
      return [
        { from: 'system', kind: 'alert', text: 'Conversación transferida al equipo', options: [] },
        text('Te comunico con una persona del equipo. En breve te van a responder.'),
      ];
    }

    if (id === 'menu_book' || /(sacar|pedir|reservar) (un )?turno/.test(t)) {
      this.state = 'specialty';
      return [list('¿Para qué especialidad querés el turno?', SPECIALTIES)];
    }

    if (this.state === 'specialty' && id?.startsWith('spec_')) {
      this.pendingSpecialty = SPECIALTIES.find((o) => o.id === id)?.title ?? 'la especialidad';
      this.state = 'slot';
      return [buttons(`Estos son los próximos horarios para ${this.pendingSpecialty}:`, SLOTS)];
    }

    if (this.state === 'slot' && id?.startsWith('slot_')) {
      const slot = (SLOTS.find((o) => o.id === id)?.title ?? '').toLowerCase();
      this.appointment = { specialty: this.pendingSpecialty ?? 'la especialidad', slot };
      this.state = 'menu';
      return [
        text(
          `¡Listo! Tu turno de ${this.appointment.specialty} quedó reservado para el ${slot}. ` +
            'Te vamos a mandar un recordatorio el día anterior.'
        ),
      ];
    }

    if (id === 'menu_mine' || t.includes('mis turnos')) {
      if (!this.appointment) {
        this.state = 'menu';
        return [text('No tenés turnos agendados.'), menu()];
      }
      this.state = 'appointment';
      return [
        buttons(
          `Tenés un turno de ${this.appointment.specialty} el ${this.appointment.slot}.`,
          [
            { id: 'appt_confirm', title: 'Confirmar asistencia' },
            { id: 'appt_cancel', title: 'Cancelar turno' },
          ]
        ),
      ];
    }

    if (this.state === 'appointment' && id === 'appt_confirm' && this.appointment) {
      this.state = 'menu';
      return [
        text(`¡Gracias! Registramos que vas a asistir a tu turno del ${this.appointment.slot}.`),
      ];
    }

    if (this.state === 'appointment' && id === 'appt_cancel' && this.appointment) {
      this.state = 'confirmCancel';
      return [
        buttons(`¿Seguro que querés cancelar tu turno del ${this.appointment.slot}?`, [
          { id: 'cancel_yes', title: 'Sí, cancelar' },
          { id: 'cancel_no', title: 'No' },
        ]),
      ];
    }

    if (this.state === 'confirmCancel' && id === 'cancel_yes') {
      this.appointment = null;
      this.state = 'menu';
      return [text('Tu turno fue cancelado. Si querés, podés sacar otro desde el menú.')];
    }

    if (this.state === 'confirmCancel' && id === 'cancel_no') {
      this.state = 'menu';
      return [text('Perfecto, tu turno sigue en pie.')];
    }

    if (this.state === 'start' || /^(hola|buen[oa]s|hi\b)/.test(t)) {
      this.state = 'menu';
      return [text('¡Hola! Soy el asistente virtual de Clínica Demo 👋'), menu()];
    }

    return [text('Perdón, no te entendí 😅. Elegí una de estas opciones:'), menu()];
  }
}

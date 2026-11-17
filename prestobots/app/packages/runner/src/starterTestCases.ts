import type { TestCase } from '@ctp/shared';

/**
 * Starter test cases loaded the first time the platform starts.
 *
 * They follow the demo bot's menu. The real Cauce chatbot uses its own wording, so after the first
 * run on salud-stage some option names will need adjusting. Generating test cases from the real
 * bot's design comes in a later iteration.
 *
 * SAL-CANCEL-002 fails on the demo bot on purpose, to show what a failure looks like.
 */
const at = '2026-11-16T00:00:00.000Z';

const starter = (testCase: Omit<TestCase, 'status' | 'origin' | 'createdAt' | 'updatedAt'>): TestCase => ({
  ...testCase,
  status: 'active',
  origin: 'starter',
  createdAt: at,
  updatedAt: at,
});

export const STARTER_TEST_CASES: TestCase[] = [
  starter({
    id: 'SAL-GREET-001',
    title: 'Patient says hello and sees the menu',
    area: 'GREET',
    story: 'Un paciente escribe "Hola". El bot lo saluda y le muestra opciones para elegir.',
    steps: [
      { action: { type: 'say', text: 'Hola' }, expect: [{ type: 'bot_replied' }, { type: 'offers_choices' }] },
    ],
  }),
  starter({
    id: 'SAL-BOOK-001',
    title: 'Patient books an appointment from the menu',
    area: 'BOOK',
    story:
      'Un paciente saluda, elige "Sacar turno", elige Cardiología y el primer horario. El bot confirma que el turno quedó reservado.',
    steps: [
      { action: { type: 'say', text: 'Hola' }, expect: [{ type: 'offers_option', option: 'Sacar turno' }] },
      { action: { type: 'choose', option: 'Sacar turno' }, expect: [{ type: 'offers_option', option: 'Cardiología' }] },
      { action: { type: 'choose', option: 'Cardiología' }, expect: [{ type: 'offers_choices' }] },
      {
        action: { type: 'choose', option: 'Martes 10:00' },
        expect: [{ type: 'mentions_any', words: ['reservado', 'confirmado', 'agendado'] }],
      },
    ],
  }),
  starter({
    id: 'SAL-BOOK-002',
    title: 'Patient asks for an appointment by writing it',
    area: 'BOOK',
    story: 'Un paciente escribe "Quiero sacar un turno" sin usar el menú. El bot le pregunta la especialidad.',
    steps: [
      { action: { type: 'say', text: 'Hola' }, expect: [{ type: 'bot_replied' }] },
      {
        action: { type: 'say', text: 'Quiero sacar un turno' },
        expect: [{ type: 'offers_choices' }, { type: 'mentions_any', words: ['especialidad'] }],
      },
    ],
  }),
  starter({
    id: 'SAL-INFO-001',
    title: 'Patient checks their appointment and confirms attendance',
    area: 'INFO',
    story: 'Un paciente entra a "Mis turnos", ve su turno y confirma que va a asistir.',
    steps: [
      { action: { type: 'say', text: 'Hola' }, expect: [{ type: 'offers_option', option: 'Mis turnos' }] },
      { action: { type: 'choose', option: 'Mis turnos' }, expect: [{ type: 'mentions_any', words: ['turno'] }] },
      {
        action: { type: 'choose', option: 'Confirmar asistencia' },
        expect: [{ type: 'mentions_any', words: ['asistir', 'confirm'] }],
      },
    ],
  }),
  starter({
    id: 'SAL-CANCEL-001',
    title: 'Patient cancels an appointment from the menu',
    area: 'CANCEL',
    story: 'Un paciente entra a "Mis turnos", elige cancelar y lo confirma. El bot avisa que el turno fue cancelado.',
    steps: [
      { action: { type: 'say', text: 'Hola' }, expect: [{ type: 'offers_option', option: 'Mis turnos' }] },
      { action: { type: 'choose', option: 'Mis turnos' }, expect: [{ type: 'offers_option', option: 'Cancelar' }] },
      { action: { type: 'choose', option: 'Cancelar turno' }, expect: [{ type: 'offers_choices' }] },
      { action: { type: 'choose', option: 'Sí, cancelar' }, expect: [{ type: 'mentions_any', words: ['cancelado'] }] },
    ],
  }),
  starter({
    id: 'SAL-CANCEL-002',
    title: 'Patient asks to cancel by writing it',
    area: 'CANCEL',
    story:
      'Un paciente escribe "Quiero cancelar mi turno" sin usar el menú. El bot entiende y le ofrece cancelar.',
    steps: [
      { action: { type: 'say', text: 'Hola' }, expect: [{ type: 'bot_replied' }] },
      {
        action: { type: 'say', text: 'Quiero cancelar mi turno' },
        expect: [{ type: 'mentions_any', words: ['cancel'] }, { type: 'mentions_none', words: ['no te entendí'] }],
      },
    ],
  }),
  starter({
    id: 'SAL-HUMAN-001',
    title: 'Patient asks to talk to a person',
    area: 'HUMAN',
    story: 'Un paciente pide hablar con una persona. El bot le avisa que lo comunica con el equipo.',
    steps: [
      {
        action: { type: 'say', text: 'Quiero hablar con una persona' },
        expect: [{ type: 'bot_replied' }, { type: 'mentions_any', words: ['persona', 'equipo', 'operador', 'asesor'] }],
      },
    ],
  }),
  starter({
    id: 'SAL-FALLBACK-001',
    title: 'Patient writes something the bot cannot understand',
    area: 'FALLBACK',
    story: 'Un paciente escribe algo sin sentido. El bot responde amablemente que no entendió y ofrece opciones.',
    steps: [
      { action: { type: 'say', text: 'Hola' }, expect: [{ type: 'bot_replied' }] },
      {
        action: { type: 'say', text: 'asdfgh qwerty' },
        expect: [{ type: 'bot_replied' }, { type: 'mentions_any', words: ['no te entend', 'no entend', 'perdon', 'disculp'] }],
      },
    ],
  }),
];

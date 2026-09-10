import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMessage, suggestTitle } from '../src/parser.js';

const REF = new Date(2026, 8, 9); // martes 9-sep-2026 (fecha de "hoy" fija para tests deterministas)

test('reunión con fecha y hora explícitas', () => {
  const r = parseMessage('Reunión de padres el 15 de octubre a las 17:00 en el aula 3.', {referenceDate: REF});
  assert.equal(r.kind, 'single');
  assert.equal(r.date, '2026-10-15');
  assert.equal(r.time.h, 17);
  assert.equal(r.allDay, false);
  assert.equal(r.confidence, 'high');
  assert.deepEqual(r.reminders.map(x=>x.minutes), [60,1440]);
});

test('pago de comedor con fecha dd/mm', () => {
  const r = parseMessage('Recuerda abonar el recibo del comedor antes del 20/09.', {referenceDate: REF});
  assert.equal(r.kind, 'deadline');
  assert.equal(r.date, '2026-09-20');
  assert.deepEqual(r.reminders.map(x=>x.minutes).sort((a,b)=>a-b), [1440,2880]);
});

test('entrega recurrente semanal por día de la semana', () => {
  const r = parseMessage('Entrega el cuaderno de lectura todos los lunes.', {referenceDate: REF});
  assert.equal(r.kind, 'recurring');
  assert.equal(r.recurrence[0], 'RRULE:FREQ=WEEKLY;BYDAY=MO');
});

test('cadencia mensual genérica', () => {
  const r = parseMessage('El comité de comedor se reúne mensualmente.', {referenceDate: REF});
  assert.equal(r.kind, 'recurring');
  assert.equal(r.recurrence[0], 'RRULE:FREQ=MONTHLY');
});

test('plazo relativo "en 3 días"', () => {
  const r = parseMessage('Debes justificar la ausencia en 3 días.', {referenceDate: REF});
  assert.equal(r.kind, 'single');
  assert.equal(r.date, '2026-09-12');
  assert.equal(r.confidence, 'medium');
});

test('"mañana" se interpreta como día siguiente, no como franja horaria', () => {
  const r = parseMessage('La excursión es mañana, salimos a las 9:00.', {referenceDate: REF});
  assert.equal(r.date, '2026-09-10');
  assert.equal(r.time.h, 9);
});

test('"esta mañana" NO se confunde con el día "mañana"', () => {
  const r = parseMessage('El aviso se envió esta mañana sobre el cambio de horario el viernes.', {referenceDate: REF});
  assert.notEqual(r.ruleId, 'manana');
  assert.equal(r.kind, 'single'); // debe caer en "el viernes"
});

test('antes de que acabe la semana', () => {
  const r = parseMessage('Enviad el formulario antes de que acabe la semana.', {referenceDate: REF});
  assert.equal(r.kind, 'deadline');
});

test('sin fecha detectable', () => {
  const r = parseMessage('Gracias por vuestra colaboración durante el curso.', {referenceDate: REF});
  assert.equal(r.kind, 'none');
});

test('suggestTitle recorta la primera línea', () => {
  const t = suggestTitle('Reunión de padres\nMás detalles abajo...');
  assert.equal(t, 'Reunión de padres');
});

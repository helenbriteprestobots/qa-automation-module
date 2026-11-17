import type { ChatMessage } from '@ctp/shared';
import { ClipboardList, ExternalLink, List } from 'lucide-react';

import { formatTime } from '../format';

/** A conversation drawn like WhatsApp: patient on the right, bot on the left, notices centred. */
export const ChatTranscript = ({ messages }: { messages: ChatMessage[] }) => {
  if (messages.length === 0) {
    return <p className="text-sm text-slate-500 italic">No messages.</p>;
  }
  return (
    <div className="space-y-2 rounded-lg bg-chat-bg p-3">
      {messages.map((message) => (
        <Bubble key={message.id} message={message} />
      ))}
    </div>
  );
};

const Bubble = ({ message }: { message: ChatMessage }) => {
  if (message.from === 'system') {
    return (
      <div className="flex justify-center">
        <span className="rounded-md bg-white/70 px-2 py-1 text-xs text-slate-600">{message.text}</span>
      </div>
    );
  }

  const isPatient = message.from === 'patient';
  return (
    <div className={`flex ${isPatient ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm sm:max-w-[70%] ${
          isPatient ? 'bg-chat-patient' : 'bg-white'
        }`}
      >
        {message.from === 'staff' && <div className="mb-0.5 text-xs font-semibold text-sky-700">Clinic staff</div>}
        <p className="whitespace-pre-wrap break-words">{message.text || <em className="text-slate-400">(empty)</em>}</p>
        {message.options.length > 0 && <Options message={message} />}
        <div className="mt-1 flex justify-end gap-2 text-[10px] text-slate-400">
          {message.deliveryStatus && !isPatient && <span>{message.deliveryStatus}</span>}
          <span>{formatTime(message.at)}</span>
        </div>
      </div>
    </div>
  );
};

const Options = ({ message }: { message: ChatMessage }) => {
  const Icon = message.kind === 'flow' ? ClipboardList : message.kind === 'list' ? List : message.kind === 'link' ? ExternalLink : null;
  return (
    <div className="mt-2 border-t border-slate-100 pt-2">
      {message.kind === 'list' && <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">List</div>}
      {message.kind === 'flow' && <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">WhatsApp form</div>}
      <div className="flex flex-wrap gap-1.5">
        {message.options.map((option) => (
          <span
            key={`${option.id}-${option.title}`}
            className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs text-sky-800"
          >
            {Icon && <Icon className="h-3 w-3" aria-hidden />}
            {option.title}
          </span>
        ))}
      </div>
    </div>
  );
};

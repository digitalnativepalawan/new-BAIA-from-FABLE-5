import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Plus, Save, Trash2, ArrowLeft, Download, Upload } from 'lucide-react';

type FaqItem = {
  id: string;
  question: string;
  keywords: string;
  answer: string;
  active: boolean;
};

type BotSettings = {
  enabled: boolean;
  provider: 'ollama';
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
};

const SETTINGS_KEY = 'kapwa_bot_settings';
const FAQ_KEY = 'kapwa_bot_faq_memory';

const defaultSettings: BotSettings = {
  enabled: true,
  provider: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen2.5:3b',
  temperature: 0.2,
  maxTokens: 180,
};

function loadSettings(): BotSettings {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return defaultSettings;
  }
}

function loadFaqs(): FaqItem[] {
  try {
    const value = JSON.parse(localStorage.getItem(FAQ_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function normalizeFaq(item: any): FaqItem | null {
  if (!item || typeof item.question !== 'string' || typeof item.answer !== 'string') return null;
  const question = item.question.trim();
  const answer = item.answer.trim();
  if (!question || !answer) return null;
  return {
    id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
    question,
    keywords: typeof item.keywords === 'string' ? item.keywords.trim() : '',
    answer,
    active: item.active !== false,
  };
}

export default function BotSettingsPage() {
  const navigate = useNavigate();
  const importRef = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState<BotSettings>(loadSettings);
  const [faqs, setFaqs] = useState<FaqItem[]>(loadFaqs);
  const [form, setForm] = useState({ question: '', keywords: '', answer: '' });

  const activeCount = useMemo(() => faqs.filter(item => item.active).length, [faqs]);

  const saveSettings = () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    toast.success('Bot settings saved');
  };

  const saveFaqs = (next: FaqItem[]) => {
    setFaqs(next);
    localStorage.setItem(FAQ_KEY, JSON.stringify(next));
  };

  const addFaq = () => {
    if (!form.question.trim() || !form.answer.trim()) {
      toast.error('Question and answer are required');
      return;
    }
    saveFaqs([
      ...faqs,
      {
        id: crypto.randomUUID(),
        question: form.question.trim(),
        keywords: form.keywords.trim(),
        answer: form.answer.trim(),
        active: true,
      },
    ]);
    setForm({ question: '', keywords: '', answer: '' });
    toast.success('Guest answer added');
  };

  const downloadAnswers = () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      answers: faqs,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `kapwa-guest-answers-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success(`${faqs.length} answers downloaded`);
  };

  const importAnswers = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      const source = Array.isArray(parsed) ? parsed : parsed?.answers;
      if (!Array.isArray(source)) throw new Error('The file does not contain an answers list.');
      const imported = source.map(normalizeFaq).filter(Boolean) as FaqItem[];
      if (imported.length === 0) throw new Error('No valid answers were found.');

      const byQuestion = new Map<string, FaqItem>();
      [...faqs, ...imported].forEach(item => byQuestion.set(item.question.toLowerCase(), item));
      saveFaqs(Array.from(byQuestion.values()));
      toast.success(`${imported.length} answers imported`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not import answers');
    } finally {
      if (importRef.current) importRef.current.value = '';
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl">Local Agent Settings</h1>
            <p className="font-body text-sm text-muted-foreground">Ollama settings and reusable answers for common guest questions.</p>
          </div>
          <Button variant="outline" onClick={() => navigate('/admin')}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Admin
          </Button>
        </div>

        <section className="border border-border rounded-lg p-4 space-y-4 bg-card">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg">Local Bot</h2>
              <p className="text-xs text-muted-foreground">Used by the Guest Portal on this device.</p>
            </div>
            <Switch checked={settings.enabled} onCheckedChange={enabled => setSettings(s => ({ ...s, enabled }))} />
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <label className="text-sm space-y-1">
              <span>Provider</span>
              <Input value="Ollama" disabled />
            </label>
            <label className="text-sm space-y-1">
              <span>Model</span>
              <Input value={settings.model} onChange={e => setSettings(s => ({ ...s, model: e.target.value }))} />
            </label>
            <label className="text-sm space-y-1 md:col-span-2">
              <span>Ollama URL</span>
              <Input value={settings.baseUrl} onChange={e => setSettings(s => ({ ...s, baseUrl: e.target.value }))} />
            </label>
            <label className="text-sm space-y-1">
              <span>Temperature</span>
              <Input type="number" min="0" max="1" step="0.1" value={settings.temperature} onChange={e => setSettings(s => ({ ...s, temperature: Number(e.target.value) }))} />
            </label>
            <label className="text-sm space-y-1">
              <span>Maximum reply tokens</span>
              <Input type="number" min="40" max="500" value={settings.maxTokens} onChange={e => setSettings(s => ({ ...s, maxTokens: Number(e.target.value) }))} />
            </label>
          </div>

          <Button onClick={saveSettings}><Save className="w-4 h-4 mr-2" />Save Bot Settings</Button>
        </section>

        <section className="border border-border rounded-lg p-4 space-y-4 bg-card">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h2 className="font-display text-lg">Guest FAQ Memory</h2>
              <p className="text-xs text-muted-foreground">{activeCount} active answers. Exact or keyword matches reply immediately without waiting for the model.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={downloadAnswers} disabled={faqs.length === 0}>
                <Download className="w-4 h-4 mr-2" />Download Answers
              </Button>
              <Button variant="outline" onClick={() => importRef.current?.click()}>
                <Upload className="w-4 h-4 mr-2" />Import Answers
              </Button>
              <input
                ref={importRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) importAnswers(file);
                }}
              />
            </div>
          </div>

          <div className="space-y-2 border border-border rounded p-3">
            <Input placeholder="Guest question, e.g. What time is breakfast?" value={form.question} onChange={e => setForm(f => ({ ...f, question: e.target.value }))} />
            <Input placeholder="Keywords, comma separated: breakfast, morning meal" value={form.keywords} onChange={e => setForm(f => ({ ...f, keywords: e.target.value }))} />
            <textarea className="w-full min-h-24 rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="Confirmed answer shown to guests" value={form.answer} onChange={e => setForm(f => ({ ...f, answer: e.target.value }))} />
            <Button onClick={addFaq}><Plus className="w-4 h-4 mr-2" />Add Answer</Button>
          </div>

          <div className="space-y-3">
            {faqs.map(item => (
              <div key={item.id} className="border border-border rounded p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-sm">{item.question}</p>
                    {item.keywords && <p className="text-xs text-muted-foreground">Keywords: {item.keywords}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={item.active} onCheckedChange={active => saveFaqs(faqs.map(f => f.id === item.id ? { ...f, active } : f))} />
                    <Button size="icon" variant="ghost" onClick={() => saveFaqs(faqs.filter(f => f.id !== item.id))}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{item.answer}</p>
              </div>
            ))}
            {faqs.length === 0 && <p className="text-sm text-muted-foreground">No reusable guest answers yet.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

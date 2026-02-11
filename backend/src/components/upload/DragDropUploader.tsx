'use client';

import { useMemo, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function DragDropUploader({ onUploaded }: { onUploaded: (datasetId: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const helper = useMemo(() => {
    if (!file) return 'Upload .xlsx (preferred) or .csv';
    return `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
  }, [file]);

  async function upload() {
    if (!file) return;
    setLoading(true);
    setError(null);

    const form = new FormData();
    form.append('file', file);
    if (name.trim()) {
      form.append('name', name.trim());
    }

    const response = await fetch('/api/datasets', {
      method: 'POST',
      body: form
    });

    setLoading(false);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: 'Upload failed' }));
      setError(payload.error ?? 'Upload failed');
      return;
    }

    const payload = await response.json();
    onUploaded(payload.datasetId);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dataset Upload</CardTitle>
        <CardDescription>Accepts ILI workbook with Summary + 2007/2015/2022 sheets.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-dashed bg-slate-50 p-6 text-center">
          <UploadCloud className="mx-auto mb-2 h-8 w-8 text-slate-500" />
          <p className="text-sm text-slate-600">Drag and drop or browse file</p>
          <Input className="mt-3" type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <p className="mt-2 text-xs text-muted-foreground">{helper}</p>
        </div>
        <Input placeholder="Dataset name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button disabled={!file || loading} onClick={upload}>
          {loading ? 'Uploading...' : 'Upload & Normalize'}
        </Button>
      </CardContent>
    </Card>
  );
}

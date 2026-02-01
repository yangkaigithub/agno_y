'use client';

import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Save, Download, FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import jsPDF from 'jspdf';

interface PRDEditorProps {
  content: string;
  projectId: string;
  onSave: (content: string) => Promise<void>;
}

export function PRDEditor({ content, projectId, onSave }: PRDEditorProps) {
  const [markdown, setMarkdown] = useState(content);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');

  useEffect(() => {
    setMarkdown(content);
  }, [content]);

  async function handleSave() {
    setIsSaving(true);
    try {
      await onSave(markdown);
    } catch (error) {
      console.error('淇濆瓨澶辫触:', error);
      alert('淇濆瓨澶辫触锛岃閲嶈瘯');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleExportPDF() {
    try {
      const pdf = new jsPDF();
      const element = document.getElementById('preview-content');
      
      if (!element) {
        // 濡傛灉娌℃湁棰勮鍏冪礌锛岀洿鎺ヤ娇鐢?markdown 鏂囨湰
        const text = markdown.split('\n').map(line => line.trim()).filter(line => line);
        pdf.setFontSize(12);
        let y = 20;
        const pageHeight = pdf.internal.pageSize.height;
        const margin = 20;
        const maxWidth = pdf.internal.pageSize.width - 2 * margin;

        text.forEach((line) => {
          if (y > pageHeight - margin) {
            pdf.addPage();
            y = margin;
          }
          
          // 澶勭悊鏍囬
          if (line.startsWith('#')) {
            pdf.setFontSize(16);
            pdf.setFont(undefined, 'bold');
            line = line.replace(/^#+\s*/, '');
          } else {
            pdf.setFontSize(12);
            pdf.setFont(undefined, 'normal');
          }

          const lines = pdf.splitTextToSize(line, maxWidth);
          lines.forEach((textLine: string) => {
            pdf.text(textLine, margin, y);
            y += 7;
          });
        });

        pdf.save(`PRD-${projectId}.pdf`);
        return;
      }

      // 浣跨敤 html2canvas 灏嗛瑙堝唴瀹硅浆鎹负鍥剧墖
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
      });

      const imgData = canvas.toDataURL('image/png');
      const imgWidth = pdf.internal.pageSize.width;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pdf.internal.pageSize.height;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pdf.internal.pageSize.height;
      }

      pdf.save(`PRD-${projectId}.pdf`);
    } catch (error) {
      console.error('瀵煎嚭 PDF 澶辫触:', error);
      alert('瀵煎嚭 PDF 澶辫触锛岃閲嶈瘯');
    }
  }

  function handleExportMarkdown() {
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PRD-${projectId}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button
            variant={activeTab === 'edit' ? 'default' : 'outline'}
            onClick={() => setActiveTab('edit')}
            size="sm"
          >
            缂栬緫
          </Button>
          <Button
            variant={activeTab === 'preview' ? 'default' : 'outline'}
            onClick={() => setActiveTab('preview')}
            size="sm"
          >
            棰勮
          </Button>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleSave}
            disabled={isSaving}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {isSaving ? '淇濆瓨涓?..' : '淇濆瓨'}
          </Button>
          <Button
            onClick={handleExportMarkdown}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <FileDown className="h-4 w-4" />
            瀵煎嚭 MD
          </Button>
          <Button
            onClick={handleExportPDF}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            瀵煎嚭 PDF
          </Button>
        </div>
      </div>

      {activeTab === 'edit' ? (
        <Textarea
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          className="min-h-[600px] font-mono text-sm"
          placeholder="杈撳叆 Markdown 鏍煎紡鐨?PRD 鍐呭..."
        />
      ) : (
        <Card>
          <CardContent className="p-6">
            <div
              id="preview-content"
              className="prose prose-slate dark:prose-invert max-w-none"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {markdown}
              </ReactMarkdown>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

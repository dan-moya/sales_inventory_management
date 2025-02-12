import { useState, useEffect } from 'react';

interface ImagePreviewProps {
  file: File | null;
  currentUrl?: string;
}

export default function ImagePreview({ file, currentUrl }: ImagePreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setPreviewUrl(null);
    }
  }, [file]);

  if (!previewUrl && !currentUrl) return null;

  return (
    <div className="mt-2">
      <img
        src={previewUrl || currentUrl}
        alt="Vista previa"
        className="h-20 w-20 object-cover rounded-lg"
      />
    </div>
  );
}
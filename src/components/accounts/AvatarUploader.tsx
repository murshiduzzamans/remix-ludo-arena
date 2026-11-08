/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, X, RotateCw, Camera } from 'lucide-react';

interface AvatarUploaderProps {
  currentAvatarUrl?: string | null;
  onUpload: (base64Image: string) => Promise<boolean>;
  onClose: () => void;
  maxSizeMB?: number;
}

type CropState = { x: number; y: number; size: number };
type ImageDimensions = { width: number; height: number };

export function AvatarUploader({ currentAvatarUrl, onUpload, onClose, maxSizeMB = 2 }: AvatarUploaderProps) {
  const [preview, setPreview] = useState<string | null>(currentAvatarUrl ?? null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [crop, setCrop] = useState<CropState>({ x: 0, y: 0, size: 200 });
  const [imageDimensions, setImageDimensions] = useState<ImageDimensions | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const validateFile = useCallback(
    (file: File): string | null => {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!allowedTypes.includes(file.type)) {
        return `Only JPG, PNG, WebP, or GIF images are allowed. Selected: ${file.type}`;
      }
      const maxBytes = maxSizeMB * 1024 * 1024;
      if (file.size > maxBytes) {
        return `Image must be smaller than ${maxSizeMB}MB. Current size: ${(file.size / (1024 * 1024)).toFixed(1)}MB`;
      }
      return null;
    },
    [maxSizeMB]
  );

  const loadImage = useCallback((file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setSelectedFile(file);

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setPreview(result);
    };
    reader.readAsDataURL(file);
  }, [validateFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadImage(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) loadImage(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = () => {
    setDragActive(false);
  };

  const handleImageLoad = () => {
    if (imageRef.current) {
      const { naturalWidth, naturalHeight } = imageRef.current;
      setImageDimensions({ width: naturalWidth, height: naturalHeight });
      const size = Math.min(naturalWidth, naturalHeight);
      setCrop({ x: (naturalWidth - size) / 2, y: (naturalHeight - size) / 2, size });
    }
  };

  const handleRotate = () => {
    if (!preview || !imageRef.current) return;
    // Create rotated image canvas
    const canvas = document.createElement('canvas');
    const img = imageRef.current;
    canvas.width = img.naturalHeight;
    canvas.height = img.naturalWidth;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, -canvas.width / 2, -canvas.height / 2);
    const rotatedDataUrl = canvas.toDataURL('image/png');
    setPreview(rotatedDataUrl);
    // Recalculate crop for rotated image
    const newDimensions = { width: img.naturalHeight, height: img.naturalWidth };
    setImageDimensions(newDimensions);
    const size = Math.min(newDimensions.width, newDimensions.height);
    setCrop({ x: (newDimensions.width - size) / 2, y: (newDimensions.height - size) / 2, size });
  };

  const handleCropChange = (value: number, field: keyof CropState) => {
    if (!imageDimensions) return;
    const newCrop = { ...crop, [field]: value };
    // Constrain crop within image bounds
    newCrop.size = Math.max(50, Math.min(newCrop.size, imageDimensions.width, imageDimensions.height));
    newCrop.x = Math.max(0, Math.min(newCrop.x, imageDimensions.width - newCrop.size));
    newCrop.y = Math.max(0, Math.min(newCrop.y, imageDimensions.height - newCrop.size));
    setCrop(newCrop);
  };

  const getCroppedImage = useCallback((): string | null => {
    if (!preview || !imageDimensions) return null;

    const canvas = document.createElement('canvas');
    const img = imageRef.current;
    if (!img) return null;

    // Calculate scale factor between displayed and natural size
    const displayWidth = img.offsetWidth || imageDimensions.width;
    const displayHeight = img.offsetHeight || imageDimensions.height;
    const scaleX = imageDimensions.width / displayWidth;
    const scaleY = imageDimensions.height / displayHeight;

    // Apply crop in natural image coordinates
    const cropX = crop.x * scaleX;
    const cropY = crop.y * scaleY;
    const cropSize = crop.size * Math.min(scaleX, scaleY);

    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      img,
      cropX,
      cropY,
      cropSize,
      cropSize,
      0,
      0,
      256,
      256
    );

    return canvas.toDataURL('image/png');
  }, [preview, crop, imageDimensions]);

  const handleSave = async () => {
    const croppedImage = getCroppedImage();
    if (!croppedImage) {
      setError('Unable to process image. Please try again.');
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const savedOnline = await onUpload(croppedImage);
      if (!savedOnline) {
        setError('Saved locally, but account sync failed.');
        return;
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="avatar-upload-title">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 id="avatar-upload-title" className="text-base font-bold text-white flex items-center gap-2">
            <Camera className="w-5 h-5 text-amber-400" />
            Upload Profile Picture
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors cursor-pointer"
            aria-label="Close upload dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-slate-400">
          Upload a JPG, PNG, or WebP image (max {maxSizeMB}MB). The image will be cropped to a square for your profile.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={handleFileChange}
          className="hidden"
          aria-label="Choose image file"
        />

        {preview ? (
          <div className="space-y-3">
            <div className="relative bg-slate-800 rounded-xl overflow-hidden border-2 border-slate-600">
              <img
                ref={imageRef}
                src={preview}
                alt="Profile picture preview"
                onLoad={handleImageLoad}
                className="w-full h-auto max-h-64 object-contain"
              />
              <div className="absolute top-2 right-2 flex gap-1">
                <button
                  onClick={handleRotate}
                  className="bg-slate-900/80 hover:bg-slate-900 text-white p-1.5 rounded-lg transition-colors cursor-pointer"
                  aria-label="Rotate image 90 degrees"
                  title="Rotate 90°"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    setPreview(currentAvatarUrl ?? null);
                    setSelectedFile(null);
                    setImageDimensions(null);
                  }}
                  className="bg-slate-900/80 hover:bg-slate-900 text-white p-1.5 rounded-lg transition-colors cursor-pointer"
                  aria-label="Remove selected image"
                  title="Remove image"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {imageDimensions && (
              <div className="space-y-2 bg-slate-800/50 rounded-xl p-3">
                <p className="text-xs font-semibold text-slate-300">Crop area</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label className="flex items-center gap-1">
                    <span className="text-slate-400">X:</span>
                    <input
                      type="range"
                      min={0}
                      max={imageDimensions.width - crop.size}
                      value={crop.x}
                      onChange={(e) => handleCropChange(Number(e.target.value), 'x')}
                      className="flex-1 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                    />
                    <span className="text-slate-300 w-8">{Math.round(crop.x)}</span>
                  </label>
                  <label className="flex items-center gap-1">
                    <span className="text-slate-400">Y:</span>
                    <input
                      type="range"
                      min={0}
                      max={imageDimensions.height - crop.size}
                      value={crop.y}
                      onChange={(e) => handleCropChange(Number(e.target.value), 'y')}
                      className="flex-1 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                    />
                    <span className="text-slate-300 w-8">{Math.round(crop.y)}</span>
                  </label>
                </div>
                <label className="flex items-center gap-1 text-xs">
                  <span className="text-slate-400">Size:</span>
                  <input
                    type="range"
                    min={50}
                    max={Math.min(imageDimensions.width, imageDimensions.height)}
                    value={crop.size}
                    onChange={(e) => handleCropChange(Number(e.target.value), 'size')}
                    className="flex-1 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                  />
                  <span className="text-slate-300 w-8">{Math.round(crop.size)}</span>
                </label>
                <div className="flex items-center gap-2 pt-1">
                  <div className="w-12 h-12 rounded-lg overflow-hidden border border-slate-600">
                    {getCroppedImage() && (
                      <img src={getCroppedImage()!} alt="Cropped preview" className="w-full h-full object-cover" />
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400">Preview of cropped 256×256 avatar</p>
                </div>
              </div>
            )}

            {error && (
              <p className="text-xs text-red-400 text-center bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2" role="alert">
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-medium text-slate-300 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={uploading}
                className="flex-1 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1"
              >
                {uploading ? 'Uploading...' : 'Save Picture'}
              </button>
            </div>
          </div>
        ) : (
          <div
            onDragEnter={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
              dragActive
                ? 'border-amber-400 bg-amber-400/10'
                : 'border-slate-600 hover:border-slate-500 bg-slate-800/50'
            }`}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            aria-label="Upload image - drag and drop or click to browse"
          >
            <Upload className="w-8 h-8 mx-auto text-slate-400 mb-2" />
            <p className="text-sm text-slate-300 font-medium">
              {dragActive ? 'Drop image here' : 'Click or drag image here'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              JPG, PNG, WebP, GIF • Max {maxSizeMB}MB
            </p>
          </div>
        )}

        {error && !preview && (
          <p className="text-xs text-red-400 text-center bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2" role="alert">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-medium text-slate-300 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Selector de foto con captura por cámara web/celular y autocompresión Canvas a JPEG < 100 KB. */
import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Camera, Loader2, Upload, X } from 'lucide-react';

interface SelectorFotoAlumnoProps {
  fotoUrlActual?: string | null;
  onChange: (archivo: File | null) => void;
  disabled?: boolean;
}

const comprimirImagenACanvas = (archivo: File): Promise<{ file: File; previewUrl: string }> =>
  new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(new Error('No se pudo leer la imagen seleccionada.'));
    lector.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('El archivo no es una imagen válida.'));
      img.onload = () => {
        const MAX_LADO = 720;
        let ancho = img.width;
        let alto = img.height;

        if (ancho > alto && ancho > MAX_LADO) {
          alto = Math.round((alto * MAX_LADO) / ancho);
          ancho = MAX_LADO;
        } else if (alto >= ancho && alto > MAX_LADO) {
          ancho = Math.round((ancho * MAX_LADO) / alto);
          alto = MAX_LADO;
        }

        const canvas = document.createElement('canvas');
        canvas.width = ancho;
        canvas.height = alto;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('No se pudo inicializar el compresor de imagen.'));
          return;
        }
        ctx.drawImage(img, 0, 0, ancho, alto);

        const intentarCalidad = (calidad: number) => {
          canvas.toBlob(
            blob => {
              if (!blob) {
                reject(new Error('No se pudo comprimir la foto.'));
                return;
              }
              if (blob.size > 100 * 1024 && calidad > 0.5) {
                intentarCalidad(Number((calidad - 0.15).toFixed(2)));
                return;
              }
              const nombreBase = archivo.name.replace(/\.[^/.]+$/, '') || `foto_${Date.now()}`;
              const archivoFinal = new File([blob], `${nombreBase}.jpg`, {
                type: 'image/jpeg',
                lastModified: Date.now(),
              });
              const previewUrl = canvas.toDataURL('image/jpeg', calidad);
              resolve({ file: archivoFinal, previewUrl });
            },
            'image/jpeg',
            calidad,
          );
        };

        intentarCalidad(0.82);
      };
      img.src = String(lector.result);
    };
    lector.readAsDataURL(archivo);
  });

const SelectorFotoAlumno: React.FC<SelectorFotoAlumnoProps> = ({
  fotoUrlActual = null,
  onChange,
  disabled = false,
}) => {
  const [previewNueva, setPreviewNueva] = useState<string | null>(null);
  const [comprimiendo, setComprimiendo] = useState(false);
  const [errorLocal, setErrorLocal] = useState<string | null>(null);
  const [mostrarCamara, setMostrarCamara] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const detenerCamara = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setMostrarCamara(false);
  };

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const procesarArchivo = async (archivo?: File | null) => {
    if (!archivo) return;
    if (!archivo.type.startsWith('image/')) {
      setErrorLocal('Selecciona un archivo de imagen válido.');
      return;
    }

    setErrorLocal(null);
    setComprimiendo(true);
    try {
      const { file, previewUrl } = await comprimirImagenACanvas(archivo);
      setPreviewNueva(previewUrl);
      onChange(file);
    } catch (err: unknown) {
      setErrorLocal(err instanceof Error ? err.message : 'Error al procesar la foto.');
    } finally {
      setComprimiendo(false);
    }
  };

  const abrirCamara = async () => {
    if (disabled) return;
    setErrorLocal(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setMostrarCamara(true);
      window.setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      }, 80);
    } catch {
      setErrorLocal('No se pudo acceder a la cámara. Verifica los permisos del navegador.');
    }
  };

  const capturarFotoCamara = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      blob => {
        detenerCamara();
        if (!blob) return;
        const archivo = new File([blob], `camara_${Date.now()}.jpg`, { type: 'image/jpeg' });
        void procesarArchivo(archivo);
      },
      'image/jpeg',
      0.9,
    );
  };

  const limpiarNuevaSeleccion = () => {
    setPreviewNueva(null);
    setErrorLocal(null);
    onChange(null);
    if (inputRef.current) inputRef.current.value = '';
    detenerCamara();
  };

  const imagenMostrada = previewNueva || fotoUrlActual;

  return (
    <div className="alumno-foto-contenedor">
      <div className="alumno-foto-caja">
        {comprimiendo ? (
          <div className="alumno-foto-estado">
            <Loader2 size={24} className="spin" style={{ color: 'var(--primary)' }} />
            <span>Optimizando foto...</span>
          </div>
        ) : mostrarCamara ? (
          <div className="alumno-foto-camara-wrap">
            <video ref={videoRef} autoPlay playsInline className="alumno-foto-video" />
            <div className="alumno-foto-camara-Controles">
              <button
                type="button"
                className="btn-refrescar"
                onClick={detenerCamara}
                style={{ width: 'auto', padding: '0.35rem 0.9rem' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-guardar-cuenta"
                onClick={capturarFotoCamara}
                style={{ width: 'auto', padding: '0.35rem 1.1rem' }}
              >
                <Camera size={16} />
                <span>Tomar Foto</span>
              </button>
            </div>
          </div>
        ) : imagenMostrada ? (
          <div className="alumno-foto-preview-wrap">
            <img src={imagenMostrada} alt="Foto del alumno" className="alumno-foto-preview-img" />
            <div className="alumno-foto-preview-acciones">
              <button
                type="button"
                className="alumnos-btn-fila"
                onClick={() => inputRef.current?.click()}
                disabled={disabled}
              >
                <Upload size={14} />
                <span>Cambiar archivo</span>
              </button>
              <button
                type="button"
                className="alumnos-btn-fila"
                onClick={() => void abrirCamara()}
                disabled={disabled}
              >
                <Camera size={14} />
                <span>Usar cámara</span>
              </button>
              {previewNueva && (
                <button
                  type="button"
                  className="alumnos-btn-fila alumnos-btn-fila--archivar"
                  onClick={limpiarNuevaSeleccion}
                  disabled={disabled}
                >
                  <X size={14} />
                  <span>Quitar</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="alumno-foto-botones">
            <button
              type="button"
              className="alumno-foto-btn-accion"
              onClick={() => inputRef.current?.click()}
              disabled={disabled}
            >
              <Upload size={22} />
              <span>Subir foto</span>
            </button>
            <button
              type="button"
              className="alumno-foto-btn-accion"
              onClick={() => void abrirCamara()}
              disabled={disabled}
            >
              <Camera size={22} />
              <span>Sacar foto</span>
            </button>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={e => void procesarArchivo(e.target.files?.[0])}
        />
      </div>

      {errorLocal && (
        <div className="alumno-campo-error" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <AlertCircle size={14} />
          <span>{errorLocal}</span>
        </div>
      )}
    </div>
  );
};

export default SelectorFotoAlumno;

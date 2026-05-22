import { EvidenceCapture } from '../../types/attendance';

export type SelfieCaptureProps = {
  active: boolean;
  busy: boolean;
  onCaptured: (capture: EvidenceCapture) => void;
  onError: (message: string) => void;
};

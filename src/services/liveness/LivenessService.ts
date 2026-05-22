import { Challenge, ChallengeType } from '../../types/attendance';

const challenges: Challenge[] = [
  {
    type: 'move_up_down',
    label: 'Move up and down',
    instruction: 'Center your face in the guide, then move up and down.',
  },
];

export interface LivenessService {
  getRandomChallenge(): Challenge;
  getAllChallengeTypes(): ChallengeType[];
  prepareForNativeAnalysis(videoUri: string, challengeType: ChallengeType): Promise<void>;
}

class GuidedLivenessService implements LivenessService {
  getRandomChallenge(): Challenge {
    return challenges[Math.floor(Math.random() * challenges.length)];
  }

  getAllChallengeTypes(): ChallengeType[] {
    return challenges.map((challenge) => challenge.type);
  }

  async prepareForNativeAnalysis(_videoUri: string, _challengeType: ChallengeType): Promise<void> {
    // Future native implementation hook: ML Kit eye-open probability, smile probability,
    // yaw angle, challenge scoring, and anti-photo spoofing heuristics.
  }
}

export const livenessService: LivenessService = new GuidedLivenessService();

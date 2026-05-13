'use client';

import {
  GravityStarsBackground as GravityStarsBackgroundPrimitive,
  type GravityStarsProps,
} from '@/components/animate-ui/components/backgrounds/gravity-stars';
import { cn } from '@/lib/utils';

type AppGravityStarsProps = GravityStarsProps & {
  variant?: 'page' | 'section';
};

export default function GravityStarsBackground({
  variant = 'page',
  className,
  starsCount,
  starsSize,
  starsOpacity,
  glowIntensity,
  movementSpeed,
  mouseInfluence,
  gravityStrength,
  starsInteraction,
  starsInteractionType,
  mouseGravity,
  ...props
}: AppGravityStarsProps) {
  const isSection = variant === 'section';

  return (
    <GravityStarsBackgroundPrimitive
      aria-hidden="true"
      starsCount={starsCount ?? (isSection ? 34 : 95)}
      starsSize={starsSize ?? (isSection ? 1.6 : 1.25)}
      starsOpacity={starsOpacity ?? (isSection ? 0.72 : 0.52)}
      glowIntensity={glowIntensity ?? (isSection ? 9 : 13)}
      movementSpeed={movementSpeed ?? (isSection ? 0.18 : 0.12)}
      mouseInfluence={mouseInfluence ?? (isSection ? 130 : 170)}
      gravityStrength={gravityStrength ?? (isSection ? 85 : 70)}
      mouseGravity={mouseGravity ?? 'attract'}
      starsInteraction={starsInteraction ?? isSection}
      starsInteractionType={starsInteractionType ?? 'merge'}
      className={cn(isSection ? 'gravity-stars-section' : 'gravity-stars-page', className)}
      {...props}
    />
  );
}

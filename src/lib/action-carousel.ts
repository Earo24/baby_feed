export const ACTION_CAROUSEL_ITEMS = ['more', 'poop', 'feed', 'solid-food'] as const;

export type ActionCarouselItem = (typeof ACTION_CAROUSEL_ITEMS)[number];

export function getActionCarouselSetWidth(itemWidth: number) {
  return itemWidth * ACTION_CAROUSEL_ITEMS.length;
}

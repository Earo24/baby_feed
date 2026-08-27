export const ACTION_CAROUSEL_ITEMS = ['more', 'poop', 'feed', 'solid-food'] as const;

export type ActionCarouselItem = (typeof ACTION_CAROUSEL_ITEMS)[number];

export function getActionCarouselSetWidth(itemWidth: number) {
  return itemWidth * ACTION_CAROUSEL_ITEMS.length;
}

export function getActionCarouselLoopPosition(
  scrollLeft: number,
  viewportWidth: number,
  itemWidth: number,
) {
  const oneSet = getActionCarouselSetWidth(itemWidth);
  const leadingInset = Math.max((viewportWidth - itemWidth) / 2, 0);
  const viewportCenterInTrack = scrollLeft + viewportWidth / 2 - leadingInset;
  const currentSet = Math.floor(viewportCenterInTrack / oneSet);
  const offsetInSet = viewportCenterInTrack - currentSet * oneSet;

  return {
    currentSet,
    middleSetScrollLeft: leadingInset + oneSet + offsetInSet - viewportWidth / 2,
  };
}

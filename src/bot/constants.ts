export const CB = {
    GROUP_PLAYED: 'gp:',
    GROUP_EXCLUDE: 'ge:',
    GROUP_UNEXCLUDE: 'gu:',
    TYPE_EXCLUDE: 'te:',
    TYPE_UNEXCLUDE: 'tu:',
    PLAYED_MARK: 'pm:',
    PLAYED_UNMARK: 'pu:',
    CITY_SELECT: 'city:',
    POLLS_BY_DATE: 'pbd:',
} as const;

export type CallbackPrefixes = typeof CB;


export type RawGame = {
  externalId: string;
  title: string;
  gameType?: string;
  gameNumber?: string;
  date: string;
  time?: string;
  venue?: string;
  district?: string;
  address?: string;
  price?: string;
  difficulty?: string;
  status?: string;
  url: string;
};

export type Game = {
  externalId: string;
  title: string;
  dateTime: Date;
  venue?: string;
  district?: string;
  address?: string;
  price?: string;
  difficulty?: string;
  status?: string;
  url: string;
  groupKey?: string;
};

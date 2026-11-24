export type Rating = {
  funny: number;
  creative: number;
  christmas: number;
};

export type Clip = {
  id: string;
  title: string;
  youtubeId: string;
  position: number;
  voteCount: number;
  score: number | null;
  myRating: Rating | null;
};

export type Party = {
  id: string;
  slug: string;
  name: string;
  votingOpen: boolean;
};

export type PartyState = {
  party: Party;
  clips: Clip[];
};

export type Tab = "clips" | "leaderboard";

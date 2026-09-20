/**
 * The RoB 2 signalling questions, verbatim in structure from the Cochrane
 * tool (Sterne et al., BMJ 2019;366:l4898; RoB 2 guidance of 22 August 2019),
 * for the *effect of assignment to intervention*.
 *
 * The wording below is a working paraphrase written for this repository, not
 * a reproduction of the Cochrane form. Anyone running real appraisals should
 * read the official guidance: https://www.riskofbias.info/welcome/rob-2-0-tool
 *
 * `branchOf` records the question this one is only reached from. A branch
 * question that is not reached is legitimately answered "NA".
 */

export const DOMAIN_KEYS = ["d1", "d2", "d3", "d4", "d5"] as const;
export type DomainKey = (typeof DOMAIN_KEYS)[number];

export const DOMAIN_TITLES: Record<DomainKey, string> = {
  d1: "Bias arising from the randomisation process",
  d2: "Bias due to deviations from intended interventions (effect of assignment)",
  d3: "Bias due to missing outcome data",
  d4: "Bias in measurement of the outcome",
  d5: "Bias in selection of the reported result",
};

export interface SignallingQuestion {
  readonly id: string;
  readonly domain: DomainKey;
  readonly text: string;
  readonly branchOf?: string;
}

export const SIGNALLING_QUESTIONS: readonly SignallingQuestion[] = [
  {
    id: "1.1",
    domain: "d1",
    text: "Was the allocation sequence random?",
  },
  {
    id: "1.2",
    domain: "d1",
    text: "Was the allocation sequence concealed until participants were enrolled and assigned to interventions?",
  },
  {
    id: "1.3",
    domain: "d1",
    text: "Did baseline differences between intervention groups suggest a problem with the randomisation process?",
  },
  {
    id: "2.1",
    domain: "d2",
    text: "Were participants aware of their assigned intervention during the trial?",
  },
  {
    id: "2.2",
    domain: "d2",
    text: "Were carers and people delivering the interventions aware of participants' assigned intervention during the trial?",
  },
  {
    id: "2.3",
    domain: "d2",
    text: "If yes or probably yes to 2.1 or 2.2: were there deviations from the intended intervention that arose because of the trial context?",
    branchOf: "2.1",
  },
  {
    id: "2.4",
    domain: "d2",
    text: "If yes or probably yes to 2.3: were these deviations likely to have affected the outcome?",
    branchOf: "2.3",
  },
  {
    id: "2.5",
    domain: "d2",
    text: "If yes or probably yes to 2.4: were these deviations from intended intervention balanced between groups?",
    branchOf: "2.4",
  },
  {
    id: "2.6",
    domain: "d2",
    text: "Was an appropriate analysis used to estimate the effect of assignment to intervention?",
  },
  {
    id: "2.7",
    domain: "d2",
    text: "If no or probably no to 2.6: was there potential for a substantial impact (on the result) of the failure to analyse participants in the group to which they were randomised?",
    branchOf: "2.6",
  },
  {
    id: "3.1",
    domain: "d3",
    text: "Were data for this outcome available for all, or nearly all, participants randomised?",
  },
  {
    id: "3.2",
    domain: "d3",
    text: "If no or probably no to 3.1: is there evidence that the result was not biased by missing outcome data?",
    branchOf: "3.1",
  },
  {
    id: "3.3",
    domain: "d3",
    text: "If no or probably no to 3.2: could missingness in the outcome depend on its true value?",
    branchOf: "3.2",
  },
  {
    id: "3.4",
    domain: "d3",
    text: "If yes, probably yes or no information to 3.3: is it likely that missingness in the outcome depended on its true value?",
    branchOf: "3.3",
  },
  {
    id: "4.1",
    domain: "d4",
    text: "Was the method of measuring the outcome inappropriate?",
  },
  {
    id: "4.2",
    domain: "d4",
    text: "Could measurement or ascertainment of the outcome have differed between intervention groups?",
  },
  {
    id: "4.3",
    domain: "d4",
    text: "Were outcome assessors aware of the intervention received by study participants?",
  },
  {
    id: "4.4",
    domain: "d4",
    text: "If yes, probably yes or no information to 4.3: could assessment of the outcome have been influenced by knowledge of the intervention received?",
    branchOf: "4.3",
  },
  {
    id: "4.5",
    domain: "d4",
    text: "If yes, probably yes or no information to 4.4: is it likely that assessment of the outcome was influenced by knowledge of the intervention received?",
    branchOf: "4.4",
  },
  {
    id: "5.1",
    domain: "d5",
    text: "Were the data that produced this result analysed in accordance with a pre-specified analysis plan finalised before unblinded outcome data were available for analysis?",
  },
  {
    id: "5.2",
    domain: "d5",
    text: "Is the numerical result being assessed likely to have been selected, on the basis of the results, from multiple eligible outcome measurements within the outcome domain?",
  },
  {
    id: "5.3",
    domain: "d5",
    text: "Is the numerical result being assessed likely to have been selected, on the basis of the results, from multiple eligible analyses of the data?",
  },
] as const;

export const QUESTION_IDS: readonly string[] = SIGNALLING_QUESTIONS.map(
  (q) => q.id,
);

export const DOMAIN_QUESTIONS: Record<DomainKey, readonly string[]> =
  DOMAIN_KEYS.reduce(
    (acc, key) => {
      acc[key] = SIGNALLING_QUESTIONS.filter((q) => q.domain === key).map(
        (q) => q.id,
      );
      return acc;
    },
    {} as Record<DomainKey, string[]>,
  );

export function questionsForDomain(domain: DomainKey): SignallingQuestion[] {
  return SIGNALLING_QUESTIONS.filter((q) => q.domain === domain);
}

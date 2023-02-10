// Copyright 2023 @paritytech/polkadot-staking-dashboard authors & contributors
// SPDX-License-Identifier: Apache-2.0

import styled from 'styled-components';

export const SummaryWrapper = styled.div`
  display: flex;
  flex-flow: row wrap;
  width: 100%;
  margin-bottom: 1rem;

  > section {
    border-bottom: 1px solid var(--border-primary-color);
    flex-basis: 100%;
    display: flex;
    flex-flow: row wrap;
    align-items: flex-end;
    margin-top: 1rem;
    padding: 0.5rem 0 0.75rem 0;

    > div:first-child {
      color: var(--text-color-secondary);
      width: 200px;
      display: flex;
      flex-flow: row wrap;
      align-items: center;

      svg {
        color: var(--network-color-primary);
      }
    }

    > div:last-child {
      color: var(--text-color-secondary);
      flex-grow: 1;
      display: flex;
      flex-flow: row wrap;
      align-items: center;
    }
  }
`;

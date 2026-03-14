// @vitest-environment jsdom
import React, { useState } from 'react';
import { describe, expect, it } from 'vitest';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CheckboxField,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Tabs,
  Textarea,
  Toggle,
  badgeStyles,
  buttonStyles,
  checkboxStyles,
  cn,
  inputStyles,
} from '../../src/client/components/ui';
import { click, render } from '../support/render';

function Showcase() {
  const [checked, setChecked] = useState(false);
  const [tab, setTab] = useState<'general' | 'advanced'>('general');

  return (
    <div>
      <Button className="custom-button">Save</Button>
      <Field label="Name" htmlFor="name" description="Shown to users">
        <Input id="name" defaultValue="Filtarr" className="custom-input" />
      </Field>
      <Textarea defaultValue="notes" />
      <Select defaultValue="a">
        <option value="a">A</option>
      </Select>
      <CheckboxField id="enabled" label="Enabled" checked={checked} onChange={setChecked} />
      <Toggle checked={checked} onChange={setChecked} label="Enabled toggle" />
      <Card className="custom-card">
        <CardHeader title="Section" description="Summary" action={<span>Action</span>} />
        <Badge variant="success">Ready</Badge>
      </Card>
      <PageHeader title="Settings" description="Configure the app" actions={<Button>Action</Button>} />
      <EmptyState title="Nothing here" description="Add data" action={<Button>Add</Button>} icon={<span>!</span>} />
      <Tabs
        items={[
          { value: 'general', label: 'General', description: 'Defaults' },
          { value: 'advanced', label: 'Advanced' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div data-state={`${checked ? 'checked' : 'unchecked'}:${tab}`} />
    </div>
  );
}

describe('ui primitives', () => {
  it('builds class names for the style helpers', () => {
    expect(cn('a', false, 'b', undefined, null, 'c')).toBe('a b c');
    expect(buttonStyles({ variant: 'danger', size: 'sm', fullWidth: true })).toContain('w-full');
    expect(inputStyles('extra')).toContain('extra');
    expect(checkboxStyles('extra')).toContain('extra');
    expect(badgeStyles('warning', 'extra')).toContain('extra');
  });

  it('renders and updates the interactive primitives', async () => {
    const view = await render(<Showcase />);

    expect(view.container.querySelector('.custom-button')?.textContent).toBe('Save');
    expect(view.container.querySelector('label[for="name"]')?.textContent).toContain('Name');
    expect(view.container.querySelector('.custom-input')).toBeTruthy();
    expect(view.container.querySelector('.custom-card')?.textContent).toContain('Section');
    expect(view.container.textContent).toContain('Nothing here');
    expect(view.container.textContent).toContain('Ready');

    await click(view.container.querySelector('#enabled'));
    expect(view.container.querySelector('[data-state]')?.dataset.state).toBe('checked:general');

    await click(view.container.querySelector('[role="switch"]'));
    expect(view.container.querySelector('[data-state]')?.dataset.state).toBe('unchecked:general');

    const advancedTab = Array.from(view.container.querySelectorAll('[role="tab"]')).find(
      (node) => node.textContent?.includes('Advanced'),
    );
    await click(advancedTab ?? null);
    expect(view.container.querySelector('[data-state]')?.dataset.state).toBe('unchecked:advanced');

    await view.unmount();
  });
});

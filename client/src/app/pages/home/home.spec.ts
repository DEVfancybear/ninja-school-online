import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Home } from './home';

describe('Home', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Home],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('hiển thị tên game và mốc giai đoạn', async () => {
    const fixture = TestBed.createComponent(Home);
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Ninja School Online');
    expect(text).toContain('M0');
  });

  it('có liên kết vào thế giới', async () => {
    const fixture = TestBed.createComponent(Home);
    await fixture.whenStable();
    const link = (fixture.nativeElement as HTMLElement).querySelector('a');
    expect(link?.textContent).toContain('Vào thế giới');
  });
});
